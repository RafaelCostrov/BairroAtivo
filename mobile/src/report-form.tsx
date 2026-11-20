import {
  deviceAddress,
  issueInput,
  selectedLocationInput,
  severities,
} from "@bairroativo/shared";
import type { AddressMatch, IssueInput } from "@bairroativo/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import {
  Accuracy,
  getCurrentPositionAsync,
  getLastKnownPositionAsync,
  reverseGeocodeAsync,
  requestForegroundPermissionsAsync,
} from "expo-location";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { z } from "zod";
import { AddressSearch } from "./address-search";
import { api, RequestError } from "./api";
import { useCategories, useIssueCache } from "./issue-queries";
import { useSession } from "./session";
import { colors, fonts, severityLabel, spaces } from "./theme";
import {
  Button,
  Chip,
  Copy,
  Field,
  Notice,
  SectionTitle,
  State,
  layout,
} from "./ui";

const formInput = issueInput.pick({
  categoryId: true,
  title: true,
  description: true,
  severity: true,
  postalCode: true,
});
type ReportValues = z.output<typeof formInput>;

const fieldErrors = {
  categoryId: "Selecione uma categoria.",
  title: "Informe um título de 5 a 100 caracteres.",
  description: "Use até 1.000 caracteres.",
  severity: "Selecione uma gravidade.",
  postalCode: "Informe um CEP com 8 dígitos.",
};

const textFields = [
  { name: "title", label: "Título", max: 100 },
  {
    name: "description",
    label: "Descrição (opcional)",
    max: 1000,
    multiline: true,
  },
] as const;

type PhotoSource = "camera" | "library";

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Location timed out")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export function ReportForm() {
  const router = useRouter();
  const { token, user } = useSession();
  const categories = useCategories();
  const updateCache = useIssueCache();
  const [photo, setPhoto] = useState<string>();
  const [pendingPhotoSource, setPendingPhotoSource] = useState<PhotoSource>();
  const [photoError, setPhotoError] = useState<string>();
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationStage, setLocationStage] = useState("");
  const [addressSearch, setAddressSearch] = useState(false);
  const [locationError, setLocationError] = useState<string>();
  const [location, setLocation] = useState<AddressMatch>();
  const locationRequest = useRef(0);
  const key = useRef<{ payload: string; value: string } | undefined>(undefined);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (Platform.OS === "web" && photo) URL.revokeObjectURL(photo);
    },
    [photo],
  );

  const form = useForm<z.input<typeof formInput>, unknown, ReportValues>({
    resolver: zodResolver(formInput),
    defaultValues: {
      categoryId: 0,
      title: "",
      description: "",
      severity: "MEDIUM",
      postalCode: "",
    },
  });

  const submit = useMutation({
    mutationFn: ({
      draft,
      idempotencyKey,
      photoUri,
    }: {
      draft: IssueInput;
      idempotencyKey: string;
      photoUri?: string;
    }) => api.create(token, draft, idempotencyKey, photoUri),
    onSuccess: (issue) => updateCache(user.id, String(issue.id), issue),
  });

  async function save(values: ReportValues) {
    if (!location) {
      setLocationError(
        "Escolha um endereço ou use sua localização antes de registrar.",
      );
      return;
    }
    const parsed = issueInput.safeParse({
      ...values,
      latitude: location.latitude,
      longitude: location.longitude,
      neighborhood: location.neighborhood,
      address: location.address,
    });
    if (!parsed.success) {
      setLocation(undefined);
      setLocationError(
        "A localização está incompleta. Escolha novamente o endereço ou use sua localização.",
      );
      return;
    }
    const draft = parsed.data;
    locationRequest.current += 1;
    const payload = JSON.stringify([draft, photo]);
    if (key.current?.payload !== payload)
      key.current = { payload, value: randomUUID() };
    try {
      const issue = await submit.mutateAsync({
        draft,
        idempotencyKey: key.current.value,
        photoUri: photo,
      });
      if (!active.current) return;
      form.reset();
      setLocation(undefined);
      setPhoto(undefined);
      setPhotoError(undefined);
      setLocationError(undefined);
      setAddressSearch(false);
      key.current = undefined;
      router.push({
        pathname: "/issues/[id]",
        params: { id: String(issue.id), created: "1" },
      });
    } catch (error) {
      if (error instanceof RequestError && error.code === "REQUEST_CONFLICT")
        key.current = undefined;
    }
  }

  function selectLocation(point: AddressMatch) {
    const parsed = selectedLocationInput.safeParse(point);
    if (!parsed.success) {
      setLocation(undefined);
      setLocationError(
        "O endereço recebido está incompleto. Tente localizar novamente.",
      );
      return;
    }
    locationRequest.current += 1;
    setLocation(parsed.data);
    form.setValue("postalCode", parsed.data.postalCode ?? "", {
      shouldDirty: true,
      shouldValidate: true,
    });
    setLocationError(undefined);
    setAddressSearch(false);
  }

  async function fillCurrentLocation() {
    const request = ++locationRequest.current;
    setLocationBusy(true);
    setLocationStage("Obtendo localização…");
    setLocationError(undefined);
    try {
      const permission = await requestForegroundPermissionsAsync();
      if (!active.current || locationRequest.current !== request) return;
      if (!permission.granted) {
        setLocationError(
          "Permita o acesso à localização nos ajustes do aparelho ou escolha um endereço.",
        );
        return;
      }
      const recent = await withTimeout(
        getLastKnownPositionAsync({ maxAge: 30_000, requiredAccuracy: 100 }),
        1500,
      ).catch(() => null);
      const { coords } =
        recent ??
        (await withTimeout(
          getCurrentPositionAsync({ accuracy: Accuracy.Balanced }),
          10_000,
        ));
      if (!active.current || locationRequest.current !== request) return;
      setLocationStage("Buscando endereço e CEP…");
      const point = { latitude: coords.latitude, longitude: coords.longitude };
      let resolved = deviceAddress(point);
      if (Platform.OS !== "web") {
        const addresses = await withTimeout(
          reverseGeocodeAsync(point),
          4000,
        ).catch(() => []);
        resolved = deviceAddress(point, addresses[0]);
      }
      if (!active.current || locationRequest.current !== request) return;
      setLocationStage("Conferindo endereço e CEP…");
      const verified = await api
        .reverseLocation(token, point.latitude, point.longitude, resolved)
        .catch(() => null);
      resolved = verified ?? { ...resolved, postalCode: null };
      if (!active.current || locationRequest.current !== request) return;
      selectLocation(resolved);
      if (
        !resolved.postalCode ||
        resolved.neighborhood === "Bairro indisponível" ||
        resolved.address === "Endereço indisponível"
      )
        setLocationError(
          "Localização obtida. Alguns dados de endereço não foram encontrados. Confira o resumo, preencha o CEP se souber ou localize pelo endereço.",
        );
    } catch {
      if (active.current && locationRequest.current === request)
        setLocationError(
          "Não foi possível obter sua localização. Tente novamente ou escolha um endereço.",
        );
    } finally {
      if (active.current) setLocationBusy(false);
    }
  }

  async function choosePhoto(source: PhotoSource) {
    setPendingPhotoSource(source);
    setPhotoError(undefined);
    try {
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!active.current) return;
        if (!permission.granted) {
          setPhotoError(
            "Permita o acesso à câmera nos ajustes do aparelho ou escolha uma foto da galeria.",
          );
          return;
        }
      }

      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        base64: false,
      };
      const selection =
        source === "camera"
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);
      if (!active.current || selection.canceled) return;
      const [asset] = selection.assets;
      const context = ImageManipulator.manipulate(asset.uri);
      const resize = Math.max(asset.width, asset.height) > 1400;
      try {
        if (resize)
          context.resize(
            asset.width >= asset.height ? { width: 1400 } : { height: 1400 },
          );
        const image = await context.renderAsync();
        try {
          const saved = await image.saveAsync({
            format: SaveFormat.JPEG,
            compress: 0.8,
            base64: false,
          });
          if (Platform.OS === "web") {
            const encoded = await (await fetch(saved.uri)).blob();
            if (active.current) setPhoto(URL.createObjectURL(encoded));
          } else if (active.current) {
            setPhoto(saved.uri);
          }
        } finally {
          image.release();
        }
      } finally {
        context.release();
      }
    } catch {
      if (active.current)
        setPhotoError(
          source === "camera"
            ? "Não foi possível tirar a foto. Tente novamente ou escolha uma foto da galeria."
            : "Não foi possível preparar a foto. Escolha outra imagem.",
        );
    } finally {
      if (active.current) setPendingPhotoSource(undefined);
    }
  }

  const { errors, isSubmitting } = form.formState;
  const photoBusy = pendingPhotoSource !== undefined;
  const busy = isSubmitting || photoBusy || locationBusy;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={layout.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={layout.section}>
          <Copy style={layout.paragraph}>
            Os registros ficam na plataforma comunitária e não são encaminhados
            à prefeitura.
          </Copy>
          <SectionTitle>Qual é o problema?</SectionTitle>
          <Copy style={styles.label}>Categoria</Copy>
          {categories.isPending ? (
            <State title="Carregando categorias" loading />
          ) : categories.isError ? (
            <State
              title="Categorias indisponíveis"
              detail={categories.error.message}
              retry={() => void categories.refetch()}
            />
          ) : !categories.data.length ? (
            <State title="Nenhuma categoria disponível" />
          ) : (
            <Controller
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <View style={layout.wrap}>
                  {categories.data.map(({ id, name }) => (
                    <Chip
                      key={id}
                      label={name}
                      selected={field.value === id}
                      disabled={busy}
                      onPress={() => field.onChange(id)}
                    />
                  ))}
                </View>
              )}
            />
          )}
          {errors.categoryId && (
            <Copy style={styles.error}>{fieldErrors.categoryId}</Copy>
          )}
          {textFields.slice(0, 2).map(({ name, label, max, ...config }) => (
            <Controller
              key={name}
              control={form.control}
              name={name}
              render={({ field }) => (
                <Field
                  label={label}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  editable={!busy}
                  maxLength={max}
                  error={errors[name] && fieldErrors[name]}
                  {...config}
                />
              )}
            />
          ))}
          <Copy style={styles.label}>Gravidade</Copy>
          <Controller
            control={form.control}
            name="severity"
            render={({ field }) => (
              <View style={layout.wrap}>
                {severities.map((severity) => (
                  <Chip
                    key={severity}
                    label={severityLabel[severity]}
                    selected={field.value === severity}
                    disabled={busy}
                    onPress={() => field.onChange(severity)}
                  />
                ))}
              </View>
            )}
          />
        </View>
        <View style={layout.section}>
          <SectionTitle>Onde aconteceu?</SectionTitle>
          <Copy style={layout.paragraph}>
            Escolha um endereço ou use a localização do aparelho.
          </Copy>
          <Button
            secondary
            icon="crosshair"
            label={locationBusy ? locationStage : "Usar minha localização"}
            onPress={() => void fillCurrentLocation()}
            busy={locationBusy}
            disabled={busy}
          />
          <Button
            secondary
            label="Localizar pelo endereço"
            icon="search"
            onPress={() => setAddressSearch(true)}
            disabled={busy || locationBusy}
          />
          {addressSearch && (
            <AddressSearch
              initialQuery={location?.label ?? ""}
              onCancel={() => setAddressSearch(false)}
              onChoose={async (point) => selectLocation(point)}
            />
          )}
          {location && (
            <View style={styles.locationSummary}>
              <Copy style={styles.label}>{location.neighborhood}</Copy>
              <Copy>{location.address}</Copy>
              <Copy style={layout.paragraph}>
                Lat. {location.latitude.toFixed(6)} · Long.{" "}
                {location.longitude.toFixed(6)}
              </Copy>
            </View>
          )}
          {locationError && <Notice error message={locationError} />}
          <Controller
            control={form.control}
            name="postalCode"
            render={({ field }) => (
              <Field
                label="CEP (opcional)"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                editable={!busy}
                keyboardType="numbers-and-punctuation"
                maxLength={9}
                error={errors.postalCode && fieldErrors.postalCode}
                hint={
                  location?.postalCode
                    ? "CEP preenchido pela localização. Confira antes de enviar."
                    : location
                      ? "CEP indisponível para este ponto. Preencha se souber."
                      : undefined
                }
              />
            )}
          />
        </View>
        <View style={layout.section}>
          <SectionTitle>Foto (opcional)</SectionTitle>
          {photo && (
            <Image
              source={{ uri: photo }}
              style={styles.photo}
              accessible
              accessibilityLabel="Foto anexada à ocorrência"
            />
          )}
          {Platform.OS !== "web" && (
            <Button
              secondary
              icon="camera"
              label="Tirar foto"
              onPress={() => void choosePhoto("camera")}
              busy={pendingPhotoSource === "camera"}
              disabled={busy}
            />
          )}
          <Button
            secondary
            icon="image"
            label="Escolher da galeria"
            onPress={() => void choosePhoto("library")}
            busy={pendingPhotoSource === "library"}
            disabled={busy}
          />
          {photo && (
            <Button
              secondary
              icon="x"
              label="Remover foto"
              onPress={() => setPhoto(undefined)}
              disabled={busy}
            />
          )}
          {photoError && <Notice error message={photoError} />}
        </View>
        <View style={layout.section}>
          {Object.keys(errors).length > 0 && (
            <Notice
              error
              message="Confira os campos destacados antes de enviar."
            />
          )}
          {submit.isError && (
            <Notice
              error
              message={
                submit.error instanceof RequestError
                  ? submit.error.message
                  : "Não foi possível enviar. Verifique a conexão e tente novamente."
              }
            />
          )}
          <Button
            label="Registrar ocorrência"
            icon="check"
            onPress={() => void form.handleSubmit(save)()}
            busy={isSubmitting}
            disabled={
              photoBusy ||
              locationBusy ||
              addressSearch ||
              !location ||
              !categories.data?.length
            }
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  label: { fontFamily: fonts.bold, fontSize: 14 },
  locationSummary: {
    gap: spaces.sm,
    backgroundColor: colors.tint,
    borderRadius: 8,
    padding: spaces.lg,
  },
  error: { color: colors.danger, fontSize: 13 },
  photo: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 9,
    backgroundColor: colors.tint,
  },
});
