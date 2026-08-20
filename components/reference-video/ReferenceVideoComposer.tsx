"use client";

import { authClient } from "@/lib/auth/auth-client";
import type { GenerationVariant } from "@/lib/reference-video/types";
import {
  ChevronDown,
  AtSign,
  ImageIcon,
  Play,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";

type ModelId = string;
type RegistryVideoModel = {
  enabled?: boolean;
  kieModelId?: string;
  displayName?: string;
  maxDuration?: number;
  aspectRatios?: string[];
};
type AspectRatio =
  | "auto"
  | "16:9"
  | "9:16"
  | "1:1"
  | "4:3"
  | "3:4"
  | "3:2"
  | "2:3";
type Quality = "480P" | "720P" | "1080P" | "4K";
type Duration = `${number}s`;
type OutputCount = "1" | "2" | "3" | "4";
type UploadedAsset = {
  id: string;
  name: string;
  type: string;
  url?: string;
  previewUrl?: string;
  status: "staged" | "uploading" | "ready" | "failed";
  error?: string;
};

type GenerationStatusPayload = {
  status?: string;
  providerTaskId?: string;
  videoUrl?: string;
  error?: string;
};

const aspectRatioOptions: Array<{
  value: AspectRatio;
  label: string;
  shape: string;
}> = [
  { value: "auto", label: "Auto", shape: "h-2 w-5" },
  { value: "16:9", label: "16:9", shape: "h-2.5 w-7" },
  { value: "9:16", label: "9:16", shape: "h-7 w-2.5" },
  { value: "1:1", label: "1:1", shape: "h-6 w-6" },
  { value: "4:3", label: "4:3", shape: "h-4 w-7" },
  { value: "3:4", label: "3:4", shape: "h-7 w-4" },
  { value: "3:2", label: "3:2", shape: "h-4 w-6" },
  { value: "2:3", label: "2:3", shape: "h-6 w-4" },
];

const qualityOptions: Quality[] = ["480P", "720P", "1080P", "4K"];
const outputCountOptions: OutputCount[] = ["1", "2", "3", "4"];
const autoBalancedModelId = "__auto_balanced";
const maxUploadedReferenceImages = 9;
const minKieReferenceImageAspectRatio = 0.4;
const maxKieReferenceImageAspectRatio = 2.5;
const minKieReferenceImageDimension = 300;
const maxKieReferenceImageDimension = 6000;

const fallbackModels: Array<{
  id: ModelId;
  label: string;
  supportedDurations: Duration[];
  supportedAspectRatios: Exclude<AspectRatio, "auto">[];
}> = [
  {
    id: "wan/2-7-videoedit",
    label: "Wan 2.7 Video Edit",
    supportedDurations: ["0s"],
    supportedAspectRatios: ["16:9", "9:16", "4:3", "3:4", "1:1"],
  },
  {
    id: "bytedance/seedance-2",
    label: "Seedance 2.0",
    supportedDurations: ["5s", "10s"],
    supportedAspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16"],
  },
  {
    id: "bytedance/seedance-2-fast",
    label: "Seedance 2.0 Fast",
    supportedDurations: ["5s", "10s"],
    supportedAspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16"],
  },
  {
    id: "veo3_fast",
    label: "Veo 3.1 Fast",
    supportedDurations: ["8s"],
    supportedAspectRatios: ["16:9", "9:16"],
  },
  {
    id: "grok-imagine/text-to-video",
    label: "Grok Imagine",
    supportedDurations: ["6s", "10s"],
    supportedAspectRatios: ["2:3", "3:2", "1:1", "16:9", "9:16"],
  },
  {
    id: "bytedance/seedance-2-mini",
    label: "Seedance 2.0 Mini",
    supportedDurations: [
      "4s",
      "5s",
      "6s",
      "7s",
      "8s",
      "9s",
      "10s",
      "11s",
      "12s",
      "13s",
      "14s",
      "15s",
    ],
    supportedAspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16"],
  },
  {
    id: "grok-imagine-video-1-5-preview",
    label: "Grok Imagine 1.5 Preview",
    supportedDurations: ["8s"],
    supportedAspectRatios: ["16:9", "9:16"],
  },
  {
    id: "kling-2.6/text-to-video",
    label: "Kling 2.6",
    supportedDurations: ["5s", "10s"],
    supportedAspectRatios: ["16:9", "9:16", "1:1"],
  },
  {
    id: "kling-3.0/video",
    label: "Kling 3.0",
    supportedDurations: ["3s", "5s", "10s", "15s"],
    supportedAspectRatios: ["16:9", "9:16", "1:1"],
  },
];

const initialVariants: GenerationVariant[] = [
  {
    id: "primary",
    label: "Primary output",
    status: "pending",
    progress: 0,
    notes: "Ready to submit.",
  },
];

const imageMentionPattern = /\[\[image:([^\]]+)\]\]/g;

function durationToSeconds(value: Duration) {
  return Number.parseInt(value, 10) || 0;
}

function nearestSupportedDuration(value: number, supportedSeconds: number[]) {
  if (!supportedSeconds.length) return Math.max(1, Math.round(value));
  return supportedSeconds.reduce(
    (closest, candidate) =>
      Math.abs(candidate - value) < Math.abs(closest - value)
        ? candidate
        : closest,
    supportedSeconds[0],
  );
}

function isContinuousDurationRange(supportedSeconds: number[]) {
  return (
    supportedSeconds.length > 4 &&
    supportedSeconds.every(
      (seconds, index) =>
        index === 0 || seconds - supportedSeconds[index - 1] === 1,
    )
  );
}

function persistableAssets(assets: UploadedAsset[]) {
  return assets.map(({ previewUrl, ...asset }) => asset);
}

function revokeAssetPreview(asset: UploadedAsset) {
  if (asset.previewUrl?.startsWith("blob:"))
    URL.revokeObjectURL(asset.previewUrl);
}

function imageMentionToken(assetId: string) {
  return `[[image:${assetId}]]`;
}

function getMentionedAssetIdsFromPrompt(prompt: string) {
  const ids: string[] = [];
  for (const match of prompt.matchAll(imageMentionPattern)) {
    const assetId = match[1];
    if (assetId && !ids.includes(assetId)) ids.push(assetId);
  }
  return ids;
}

function removeImageMentionFromPrompt(prompt: string, assetId: string) {
  return prompt
    .replaceAll(imageMentionToken(assetId), "")
    .replace(/\s{2,}/g, " ");
}

function loadImageElement(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to read image dimensions."));
    };
    image.src = url;
  });
}

function canvasToPngFile(canvas: HTMLCanvasElement, sourceFile: File) {
  return new Promise<File>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Unable to prepare reference image."));
        return;
      }
      const baseName = sourceFile.name.replace(/\.[^.]+$/, "") || "reference";
      resolve(
        new File([blob], `${baseName}-kie-ready.png`, { type: "image/png" }),
      );
    }, "image/png");
  });
}

async function prepareKieReferenceImageFile(file: File) {
  const image = await loadImageElement(file);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const ratio = width / height;
  const needsRatioPadding =
    ratio < minKieReferenceImageAspectRatio ||
    ratio > maxKieReferenceImageAspectRatio;
  const needsResize =
    width < minKieReferenceImageDimension ||
    height < minKieReferenceImageDimension ||
    width > maxKieReferenceImageDimension ||
    height > maxKieReferenceImageDimension;

  if (!needsRatioPadding && !needsResize) return file;

  let paddedWidth = width;
  let paddedHeight = height;
  if (ratio < minKieReferenceImageAspectRatio) {
    paddedWidth = Math.ceil(height * minKieReferenceImageAspectRatio);
  } else if (ratio > maxKieReferenceImageAspectRatio) {
    paddedHeight = Math.ceil(width / maxKieReferenceImageAspectRatio);
  }

  const scale = Math.min(
    maxKieReferenceImageDimension / paddedWidth,
    maxKieReferenceImageDimension / paddedHeight,
    Math.max(
      1,
      minKieReferenceImageDimension / paddedWidth,
      minKieReferenceImageDimension / paddedHeight,
    ),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(
    minKieReferenceImageDimension,
    Math.round(paddedWidth * scale),
  );
  canvas.height = Math.max(
    minKieReferenceImageDimension,
    Math.round(paddedHeight * scale),
  );

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to prepare reference image.");
  context.clearRect(0, 0, canvas.width, canvas.height);
  const drawWidth = Math.round(width * scale);
  const drawHeight = Math.round(height * scale);
  context.drawImage(
    image,
    Math.round((canvas.width - drawWidth) / 2),
    Math.round((canvas.height - drawHeight) / 2),
    drawWidth,
    drawHeight,
  );

  return canvasToPngFile(canvas, file);
}

function AssetPreview({ asset }: { asset: UploadedAsset }) {
  const source = asset.previewUrl || asset.url;
  return (
    <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
      {source && asset.type.startsWith("image/") ? (
        <img src={source} alt="" className="h-full w-full object-cover" />
      ) : null}
      {!source && !asset.type.startsWith("video/") ? (
        <ImageIcon className="h-5 w-5" aria-hidden="true" />
      ) : null}
    </div>
  );
}

export function ReferenceVideoComposer({
  initialPrompt = "",
  initialProjectId,
  initialSceneId,
  initialProjectVersionId,
  initialDuration,
  initialModel,
}: {
  initialPrompt?: string | null;
  initialProjectId?: string | null;
  initialSceneId?: string | null;
  initialProjectVersionId?: string | null;
  initialDuration?: number | null;
  initialModel?: string | null;
}) {
  const t = useTranslations("videoGenerate");
  const { data: session } = authClient.useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptEditorRef = useRef<HTMLDivElement>(null);
  const mentionTriggerRangeRef = useRef<Range | null>(null);
  const formatPanelRef = useRef<HTMLDivElement>(null);
  const referenceMenuRef = useRef<HTMLDivElement>(null);
  const previewUrlsRef = useRef<Set<string>>(new Set());

  const [prompt, setPrompt] = useState(initialPrompt || "");
  const [model, setModel] = useState<ModelId>(autoBalancedModelId);
  const [models, setModels] = useState(fallbackModels);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [quality, setQuality] = useState<Quality>("720P");
  const [duration, setDuration] = useState<Duration>("8s");
  const [outputCount, setOutputCount] = useState<OutputCount>("1");
  const [isFormatOpen, setIsFormatOpen] = useState(false);
  const [isReferenceMenuOpen, setIsReferenceMenuOpen] = useState(false);
  const [mentionedAssetIds, setMentionedAssetIds] = useState<string[]>([]);
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const [error, setError] = useState("");
  const [variants, setVariants] = useState<GenerationVariant[]>(initialVariants);

  const selectedModelConfig =
    model === autoBalancedModelId
      ? models.find((modelOption) => modelOption.id === "bytedance/seedance-2") ?? models[0]
      : models.find((modelOption) => modelOption.id === model) ?? models[0];
  const supportedAspectRatioOptions = aspectRatioOptions.filter(
    (option) =>
      option.value === "auto" ||
      selectedModelConfig.supportedAspectRatios.includes(option.value),
  );
  const supportedDurationSeconds = selectedModelConfig.supportedDurations
    .map(durationToSeconds)
    .filter((seconds) => seconds > 0)
    .sort((a, b) => a - b);
  const isContinuousDuration = isContinuousDurationRange(supportedDurationSeconds);
  const minSelectableDuration = supportedDurationSeconds[0] ?? 5;
  const maxSelectableDuration =
    supportedDurationSeconds[supportedDurationSeconds.length - 1] ??
    minSelectableDuration;
  const isRunning = variants.some(
    (variant) => variant.status === "queued" || variant.status === "generating",
  );
  const hasStartedGeneration = variants.some(
    (variant) =>
      variant.status !== "pending" ||
      Boolean(variant.providerTaskId || variant.videoUrl || variant.error),
  );
  const storageKey = "prompt-lens-video-gen";
  const workflowContext = {
    projectId: initialProjectId || undefined,
    sceneId: initialSceneId || undefined,
    projectVersionId: initialProjectVersionId || undefined,
  };
  const readyReplacementAssets = assets.filter(
    (asset) => asset.status === "ready" && asset.type.startsWith("image/"),
  );
  const uploadedReferenceImageCount = assets.filter(
    (asset) => asset.type.startsWith("image/") && asset.status !== "failed",
  ).length;
  const hasUploadingReplacementAssets = assets.some(
    (asset) => asset.status === "uploading" && asset.type.startsWith("image/"),
  );
  const mentionableAssets = readyReplacementAssets;
  const generationMode = readyReplacementAssets.length
    ? {
        label: "Image to video",
        description: "Animate uploaded image references with the prompt.",
      }
    : {
        label: "Text to video",
        description: "No upload needed. Generate directly from the prompt.",
      };
  const activeGenerationTaskIdsKey = variants
    .filter(
      (variant) => variant.status === "generating" && variant.providerTaskId,
    )
    .map((variant) => variant.providerTaskId)
    .join("|");
  const durationSeconds = durationToSeconds(duration);
  const durationLabel = duration === "0s" ? "Original" : duration;
  const formatSummary = `${aspectRatio} | ${quality} | ${durationLabel} | ${outputCount} Variation${outputCount === "1" ? "" : "s"}`;

  useEffect(() => {
    let cancelled = false;
    async function loadModelRegistry() {
      try {
        const response = await fetch("/api/models?category=video_generation");
        const data = await response.json();
        const registryModels = Array.isArray(data.models)
          ? data.models
              .filter((item: RegistryVideoModel) => item.enabled && item.kieModelId)
              .map((item: RegistryVideoModel) => ({
                id: item.kieModelId as ModelId,
                label: item.displayName || item.kieModelId,
                supportedDurations: item.maxDuration ? [`${item.maxDuration}s` as Duration] : ["5s" as Duration],
                supportedAspectRatios: (item.aspectRatios || ["16:9"]) as Exclude<AspectRatio, "auto">[],
              }))
          : [];
        if (!cancelled && registryModels.length) {
          setModels(registryModels);
          if (initialModel && registryModels.some((item: { id: ModelId }) => item.id === initialModel)) setModel(initialModel);
          else if (!initialModel) setModel(autoBalancedModelId);
        }
      } catch {
        if (!cancelled) setModels(fallbackModels);
      }
    }
    void loadModelRegistry();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(
    () => () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    function closeFormatPanel(event: MouseEvent) {
      if (!formatPanelRef.current?.contains(event.target as Node))
        setIsFormatOpen(false);
      if (!referenceMenuRef.current?.contains(event.target as Node))
        setIsReferenceMenuOpen(false);
    }
    document.addEventListener("mousedown", closeFormatPanel);
    return () => document.removeEventListener("mousedown", closeFormatPanel);
  }, []);

  function createImageMentionNode(assetId: string) {
    const asset = assets.find((item) => item.id === assetId);
    const source = asset?.previewUrl || asset?.url;
    const index = mentionableAssets.findIndex((item) => item.id === assetId);
    const node = document.createElement("span");
    node.contentEditable = "false";
    node.dataset.imageMentionId = assetId;
    node.className =
      "mx-1 inline-flex max-w-[12rem] translate-y-1 items-center gap-1.5 rounded-lg border border-border bg-muted px-1.5 py-1 align-baseline text-xs font-medium text-foreground";

    if (source) {
      const image = document.createElement("img");
      image.src = source;
      image.alt = "";
      image.className = "h-7 w-7 shrink-0 rounded-md object-cover";
      node.appendChild(image);
    } else {
      const icon = document.createElement("span");
      icon.className =
        "grid h-7 w-7 shrink-0 place-items-center rounded-md bg-background text-muted-foreground";
      icon.textContent = "@";
      node.appendChild(icon);
    }

    const label = document.createElement("span");
    label.className = "min-w-0 truncate";
    label.textContent = asset
      ? `Image ${String(index + 1).padStart(2, "0")}`
      : "Missing image";
    node.appendChild(label);
    return node;
  }

  function syncPromptEditor(nextPrompt = prompt) {
    const editor = promptEditorRef.current;
    if (!editor) return;
    const nodes: Node[] = [];
    let lastIndex = 0;
    for (const match of nextPrompt.matchAll(imageMentionPattern)) {
      if (match.index === undefined) continue;
      if (match.index > lastIndex) {
        nodes.push(
          document.createTextNode(nextPrompt.slice(lastIndex, match.index)),
        );
      }
      const assetId = match[1];
      if (assetId) nodes.push(createImageMentionNode(assetId));
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < nextPrompt.length) {
      nodes.push(document.createTextNode(nextPrompt.slice(lastIndex)));
    }
    editor.replaceChildren(...nodes);
  }

  function setPromptText(nextPrompt: string) {
    setPrompt(nextPrompt);
    window.requestAnimationFrame(() => syncPromptEditor(nextPrompt));
  }

  function serializePromptEditor() {
    const editor = promptEditorRef.current;
    if (!editor) return prompt;
    let nextPrompt = "";
    editor.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        nextPrompt += node.textContent || "";
        return;
      }
      if (node instanceof HTMLElement && node.dataset.imageMentionId) {
        nextPrompt += imageMentionToken(node.dataset.imageMentionId);
        return;
      }
      nextPrompt += node.textContent || "";
    });
    return nextPrompt;
  }

  function handlePromptInput() {
    setPrompt(serializePromptEditor());
  }

  function placeCursorAfter(node: Node) {
    const editor = promptEditorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection) return;
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function insertImageMention(assetId: string) {
    const editor = promptEditorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    const savedRange = mentionTriggerRangeRef.current;
    const range =
      savedRange && editor.contains(savedRange.commonAncestorContainer)
        ? savedRange.cloneRange()
        : selection?.rangeCount &&
            editor.contains(selection.getRangeAt(0).commonAncestorContainer)
          ? selection.getRangeAt(0)
          : document.createRange();
    if (
      !savedRange &&
      (!selection?.rangeCount ||
        !editor.contains(range.commonAncestorContainer))
    ) {
      range.selectNodeContents(editor);
      range.collapse(false);
    }

    if (
      range.collapsed &&
      range.startContainer.nodeType === Node.TEXT_NODE &&
      range.startOffset > 0 &&
      range.startContainer.textContent?.[range.startOffset - 1] === "@"
    ) {
      range.setStart(range.startContainer, range.startOffset - 1);
    }

    const mentionNode = createImageMentionNode(assetId);
    const trailingSpace = document.createTextNode(" ");
    range.deleteContents();
    range.insertNode(trailingSpace);
    range.insertNode(mentionNode);
    placeCursorAfter(trailingSpace);
    mentionTriggerRangeRef.current = null;
    setPrompt(serializePromptEditor());
    setIsReferenceMenuOpen(false);
  }

  function setDurationSeconds(value: number) {
    const rounded = Math.round(value);
    const nextSeconds = isContinuousDuration
      ? Math.max(
          minSelectableDuration,
          Math.min(maxSelectableDuration, rounded),
        )
      : nearestSupportedDuration(rounded, supportedDurationSeconds);
    setDuration(`${nextSeconds}s` as Duration);
  }

  function clearPrompt() {
    setPromptText("");
    promptEditorRef.current?.focus();
  }

  function handlePromptKeyUp(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "@") return;
    if (!mentionableAssets.length) return;
    const editor = promptEditorRef.current;
    const selection = window.getSelection();
    if (editor && selection?.rangeCount) {
      const range = selection.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) {
        mentionTriggerRangeRef.current = range.cloneRange();
      }
    }
    setIsReferenceMenuOpen(true);
  }

  function buildPromptWithInlineImageReferences(
    rawPrompt: string,
    replacementAssets: UploadedAsset[],
  ) {
    let nextPrompt = rawPrompt;
    replacementAssets.forEach((asset, index) => {
      nextPrompt = nextPrompt.replaceAll(
        imageMentionToken(asset.id),
        `image reference ${index + 1} (${asset.name})`,
      );
    });
    return nextPrompt.replace(imageMentionPattern, "").trim();
  }

  useEffect(() => {
    syncPromptEditor(prompt);
  }, [assets]);

  useEffect(() => {
    setMentionedAssetIds(getMentionedAssetIdsFromPrompt(prompt));
  }, [prompt]);

  useEffect(() => {
    const savedPrompt = window.localStorage.getItem(`reference-prompt-${storageKey}`);
    const savedSettings = window.localStorage.getItem(
      `reference-settings-${storageKey}`,
    );
    const savedAssets = window.localStorage.getItem(`reference-assets-${storageKey}`);
    const savedGeneration = window.localStorage.getItem(
      `reference-generation-${storageKey}`,
    );
    if (savedPrompt) setPromptText(savedPrompt);
    if (savedAssets) {
      try {
        const parsedAssets = JSON.parse(savedAssets) as UploadedAsset[];
        if (Array.isArray(parsedAssets))
          setAssets(
            parsedAssets
              .filter((asset) => asset.status === "ready")
              .map((asset) => ({ ...asset, previewUrl: asset.url })),
          );
      } catch {}
    }
    if (savedGeneration) {
      try {
        const parsedGeneration = JSON.parse(savedGeneration) as
          | GenerationVariant
          | GenerationVariant[];
        const restoredGeneration = Array.isArray(parsedGeneration)
          ? parsedGeneration
          : [parsedGeneration];
        if (
          restoredGeneration.some(
            (variant) => variant.providerTaskId || variant.videoUrl,
          )
        )
          setVariants(restoredGeneration);
      } catch {}
    }
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings) as Partial<{
          model: ModelId;
          aspectRatio: AspectRatio;
          quality: Quality;
          duration: Duration;
          outputCount: OutputCount;
        }>;
        if (!initialModel && parsed.model) setModel(parsed.model);
        if (parsed.aspectRatio) setAspectRatio(parsed.aspectRatio);
        if (parsed.quality) setQuality(parsed.quality);
        if (parsed.duration) setDuration(parsed.duration);
        if (parsed.outputCount) setOutputCount(parsed.outputCount);
      } catch {}
    }
  }, [storageKey, initialModel]);

  useEffect(() => {
    if (initialPrompt && initialPrompt.trim()) {
      setPromptText(initialPrompt.trim());
      setVariants(initialVariants);
    }
  }, [initialPrompt]);

  useEffect(() => {
    if (initialModel) setModel(initialModel);
  }, [initialModel]);

  useEffect(() => {
    if (initialDuration && Number.isFinite(initialDuration) && initialDuration > 0) {
      setDuration(`${Math.round(initialDuration)}s` as Duration);
    }
  }, [initialDuration]);

  useEffect(() => {
    if (aspectRatio === "auto") return;
    if (selectedModelConfig.supportedAspectRatios.includes(aspectRatio)) return;
    setAspectRatio(selectedModelConfig.supportedAspectRatios[0] ?? "16:9");
  }, [aspectRatio, selectedModelConfig]);

  useEffect(() => {
    const taskIds = activeGenerationTaskIdsKey.split("|").filter(Boolean);
    if (!taskIds.length) return;
    let cancelled = false;
    let timeoutId: number | undefined;

    function persistGenerationVariants(nextVariants: GenerationVariant[]) {
      window.localStorage.setItem(
        `reference-generation-${storageKey}`,
        JSON.stringify(nextVariants),
      );
    }

    async function pollGenerationStatus() {
      const results = await Promise.all(
        taskIds.map(async (taskId) => {
          try {
            const response = await fetch(
              `/api/generation-jobs?taskId=${encodeURIComponent(taskId)}`,
            );
            const payload = (await response
              .json()
              .catch(() => ({}))) as GenerationStatusPayload;
            if (!response.ok)
              throw new Error(
                payload.error || "Failed to check generation status",
              );
            return { taskId, payload };
          } catch (error) {
            return { taskId, error };
          }
        }),
      );

      if (cancelled) return;
      setVariants((current) => {
        const next = current.map((variant) => {
          const taskId = variant.providerTaskId;
          if (!taskId) return variant;
          const result = results.find((item) => item.taskId === taskId);
          if (!result) return variant;

          if ("error" in result) {
            return {
              ...variant,
              notes:
                result.error instanceof Error
                  ? result.error.message
                  : "Waiting for generation status...",
            };
          }

          const providerTaskId = result.payload.providerTaskId || taskId;
          if (result.payload.status === "success" && result.payload.videoUrl) {
            return {
              ...variant,
              status: "completed" as const,
              progress: 100,
              providerTaskId,
              videoUrl: result.payload.videoUrl,
              notes: "Generation completed.",
            };
          }

          if (result.payload.status === "fail") {
            const failureReason = result.payload.error || "Generation failed.";
            return {
              ...variant,
              status: "failed" as const,
              progress: 100,
              providerTaskId,
              error: failureReason,
              notes: failureReason,
            };
          }

          return {
            ...variant,
            providerTaskId,
            progress: Math.min(95, Math.max(variant.progress + 6, 28)),
            notes: "Generating video. Checking provider status...",
          };
        });
        persistGenerationVariants(next);
        return next;
      });

      timeoutId = window.setTimeout(pollGenerationStatus, 3000);
    }

    timeoutId = window.setTimeout(pollGenerationStatus, 1000);
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [activeGenerationTaskIdsKey, storageKey]);

  async function uploadFiles(files: FileList | File[]) {
    setError("");
    let remainingImageSlots = Math.max(
      0,
      maxUploadedReferenceImages - uploadedReferenceImageCount,
    );
    const incoming = Array.from(files).filter((file) => {
      if (!file.type.startsWith("image/")) return false;
      if (remainingImageSlots <= 0) return false;
      remainingImageSlots -= 1;
      return true;
    });

    const nextAssets: UploadedAsset[] = incoming.map((file) => ({
      id: `${file.name}-${file.lastModified}`,
      name: file.name,
      type: file.type,
      previewUrl: URL.createObjectURL(file),
      status: "uploading",
    }));
    nextAssets.forEach((asset) => {
      if (asset.previewUrl?.startsWith("blob:"))
        previewUrlsRef.current.add(asset.previewUrl);
    });
    setAssets((current) => [...current, ...nextAssets]);

    await Promise.all(
      nextAssets.map(async (asset, index) => {
        const file = incoming[index];
        if (!file?.type.startsWith("image/")) return;
        try {
          const preparedFile = await prepareKieReferenceImageFile(file);
          const formData = new FormData();
          formData.append("file", preparedFile);
          formData.append("assetType", "product");
          const response = await fetch("/api/project-assets", {
            method: "POST",
            body: formData,
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || typeof payload.id !== "string")
            throw new Error(payload.error || "Failed to upload asset");
          setAssets((current) =>
            current.map((item) =>
              item.id === asset.id
                ? {
                    ...item,
                    id: payload.id,
                    name: payload.fileName || item.name,
                    url: payload.url,
                    status: "ready",
                  }
                : item,
            ),
          );
        } catch (uploadError) {
          setAssets((current) =>
            current.map((item) =>
              item.id === asset.id
                ? {
                    ...item,
                    status: "failed",
                    error:
                      uploadError instanceof Error
                        ? uploadError.message
                        : "Failed to upload asset",
                  }
                : item,
            ),
          );
        }
      }),
    );
  }

  function toggleMentionedAsset(assetId: string) {
    if (mentionedAssetIds.includes(assetId)) {
      setPromptText(removeImageMentionFromPrompt(prompt, assetId));
      setIsReferenceMenuOpen(false);
      return;
    }
    insertImageMention(assetId);
  }

  async function submitGenerationJob() {
    if (hasUploadingReplacementAssets)
      return setError(t("errors.assetUploading") || "Asset uploading");
    if (!prompt.trim())
      return setError(t("errors.missingPrompt") || "Missing prompt");
    if (!session?.user) return setError(t("errors.loginRequired") || "Please login");

    const inlineMentionedAssetIds = getMentionedAssetIdsFromPrompt(prompt);
    const selectedReplacementAssets = inlineMentionedAssetIds.length
      ? inlineMentionedAssetIds
          .map((assetId) =>
            readyReplacementAssets.find((asset) => asset.id === assetId),
          )
          .filter((asset): asset is UploadedAsset => Boolean(asset))
      : readyReplacementAssets;
    const promptWithInlineReferences = buildPromptWithInlineImageReferences(
      prompt,
      selectedReplacementAssets,
    );
    const replacementAssets = selectedReplacementAssets.map((asset) => ({
      id: asset.id,
      type: "product",
      name: asset.name,
      url: asset.url,
    }));
    const requestedOutputCount = Number(outputCount);
    const variantCount = Number.isFinite(requestedOutputCount)
      ? Math.max(1, Math.min(4, requestedOutputCount))
      : 1;
    const queuedVariants: GenerationVariant[] = Array.from(
      { length: variantCount },
      (_, index) => ({
        id: `variant-${index + 1}`,
        label: `Variation ${index + 1}`,
        status: "queued",
        progress: 8,
        notes: "Submitting image-to-video generation.",
      }),
    );
    setVariants(queuedVariants);

    const submittedVariants = [...queuedVariants];
    for (let index = 0; index < variantCount; index += 1) {
      const variantId = queuedVariants[index].id;
      try {
        setVariants((current) =>
          current.map((variant) =>
            variant.id === variantId
              ? {
                  ...variant,
                  status: "generating",
                  progress: 12,
                  notes: `Submitting variation ${index + 1} of ${variantCount}.`,
                }
              : variant,
          ),
        );
        const response = await fetch("/api/generation-jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userPrompt: promptWithInlineReferences,
            prompt: [
              `Selected public model: ${model === autoBalancedModelId ? "Auto · Balanced" : model}.`,
              `Quality: ${quality}. Duration: ${duration}.`,
              variantCount > 1
                ? `Generate variation ${index + 1} of ${variantCount}. Use a distinct composition, motion path, timing, or camera interpretation while preserving the same subject and user direction.`
                : "",
              promptWithInlineReferences
                ? `User direction: ${promptWithInlineReferences}`
                : "User direction: follow the reference analysis and replacement product image.",
            ]
              .filter(Boolean)
              .join("\n"),
            replacementAssets,
            aspectRatio,
            model: model === autoBalancedModelId ? undefined : model,
            duration,
            quality,
            projectId: workflowContext.projectId,
            sceneId: workflowContext.sceneId,
            projectVersionId: workflowContext.projectVersionId,
            editState: {
              userPrompt: prompt,
              settings: { model, aspectRatio, quality, duration, outputCount },
              assets: persistableAssets(selectedReplacementAssets),
            },
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(payload.error || "Failed to create generation job");
        const taskId = payload.providerTaskId as string;
        const submittedVariant: GenerationVariant = {
          ...queuedVariants[index],
          status: "generating",
          progress: 20,
          providerTaskId: taskId,
          notes: `Submitted variation ${index + 1} of ${variantCount}.`,
        };
        submittedVariants[index] = submittedVariant;
        setVariants((current) =>
          current.map((variant) =>
            variant.id === variantId ? submittedVariant : variant,
          ),
        );
      } catch (submitError) {
        const failedVariant: GenerationVariant = {
          ...queuedVariants[index],
          status: "failed",
          progress: 100,
          error:
            submitError instanceof Error
              ? submitError.message
              : "Failed to create generation job",
          notes: "Submission failed.",
        };
        submittedVariants[index] = failedVariant;
        setVariants((current) =>
          current.map((variant) =>
            variant.id === variantId ? failedVariant : variant,
          ),
        );
      }
    }

    window.localStorage.setItem(
      `reference-generation-${storageKey}`,
      JSON.stringify(submittedVariants),
    );
  }

  async function createVideo() {
    setError("");
    try {
      await submitGenerationJob();
    } catch (generationError) {
      setVariants([
        {
          ...initialVariants[0],
          status: "failed",
          progress: 100,
          error:
            generationError instanceof Error
              ? generationError.message
              : "Generation failed",
          notes: "Generation failed.",
        },
      ]);
      setError(
        generationError instanceof Error
          ? generationError.message
          : "Generation failed",
      );
    }
  }

  function persistSettings() {
    window.localStorage.setItem(
      `reference-settings-${storageKey}`,
      JSON.stringify({ model: model === autoBalancedModelId ? undefined : model, aspectRatio, quality, duration, outputCount }),
    );
    window.localStorage.setItem(`reference-prompt-${storageKey}`, prompt);
    window.localStorage.setItem(
      `reference-assets-${storageKey}`,
      JSON.stringify(persistableAssets(assets)),
    );
  }

  useEffect(() => {
    persistSettings();
  }, [model, aspectRatio, quality, duration, outputCount, prompt, assets]);

  return (
    <main className="min-h-[calc(100vh-5rem)] bg-background text-foreground">
      <div className="mx-auto flex max-w-[1680px] flex-col gap-5 px-4 py-4 lg:px-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("title") || "Video Generation"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("subtitle") || "Generate AI videos from prompts and reference images."}
            </p>
          </div>
        </div>

        <div className="grid items-stretch gap-4 xl:grid-cols-[0.74fr_1.26fr]">
          <section className="flex h-full flex-col rounded-2xl border border-border bg-card p-3 shadow-sm">
            <div className="flex h-full flex-col space-y-2">
              <div>
                <h2 className="text-xl font-semibold">
                  {t("panel.title") || "Create"}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("panel.description") || "Upload reference images and describe the video you want."}
                </p>
              </div>

              <div
                className="rounded-2xl border border-dashed border-border bg-muted/30 p-3"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void uploadFiles(event.dataTransfer.files);
                }}
              >
                <input
                  ref={fileInputRef}
                  className="sr-only"
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) =>
                    event.target.files
                      ? void uploadFiles(event.target.files)
                      : undefined
                  }
                />
                <button
                  type="button"
                  onClick={() => {
                    fileInputRef.current?.click();
                  }}
                  className="flex min-h-20 w-full flex-col items-center justify-center gap-1.5 rounded-xl bg-background py-3 text-center transition-colors hover:bg-accent"
                >
                  <Upload
                    className="h-6 w-6 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="text-base font-semibold">
                    {t("upload.title") || "Upload reference images"}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {t("upload.click") || "Click or drag to upload"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {uploadedReferenceImageCount}/{maxUploadedReferenceImages}{" "}
                    images
                  </span>
                </button>

                <div className="mt-3 rounded-xl border border-border bg-background px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-foreground">
                      {generationMode.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Current path
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {generationMode.description}
                  </p>
                </div>
                {assets.length ? (
                  <div className="mt-3 grid max-h-32 gap-2 overflow-y-auto pr-1">
                    {assets.map((asset) => (
                      <div
                        key={asset.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background p-2 text-sm"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <AssetPreview asset={asset} />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{asset.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {asset.type || "file"} · {asset.status}
                            </p>
                            {asset.error ? (
                              <p className="text-xs text-destructive">
                                {asset.error}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={() => {
                            const nextPrompt = removeImageMentionFromPrompt(
                              prompt,
                              asset.id,
                            );
                            setPromptText(nextPrompt);
                            setAssets((current) => {
                              revokeAssetPreview(asset);
                              if (asset.previewUrl)
                                previewUrlsRef.current.delete(asset.previewUrl);
                              return current.filter(
                                (item) => item.id !== asset.id,
                              );
                            });
                          }}
                          aria-label="Remove asset"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border border-border bg-background p-3">
                <div className="relative">
                  {!prompt ? (
                    <span className="pointer-events-none absolute left-0 top-0 text-sm leading-6 text-muted-foreground">
                      {t("prompt.placeholder") || "Describe the video you want to generate..."}
                    </span>
                  ) : null}
                  {prompt ? (
                    <button
                      type="button"
                      onClick={clearPrompt}
                      className="absolute right-0 top-0 z-10 grid h-7 w-7 place-items-center rounded-md bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Clear prompt"
                      title="Clear prompt"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                  <div
                    ref={promptEditorRef}
                    contentEditable
                    suppressContentEditableWarning
                    role="textbox"
                    aria-multiline="true"
                    aria-label={t("prompt.placeholder") || "Prompt"}
                    className="max-h-52 min-h-24 w-full min-w-0 overflow-y-auto overflow-x-hidden bg-transparent pr-9 text-sm leading-6 outline-none"
                    onInput={handlePromptInput}
                    onKeyUp={handlePromptKeyUp}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between border-t border-border pt-1">
                  <div className="flex items-center gap-1">
                    <div ref={referenceMenuRef} className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          mentionTriggerRangeRef.current = null;
                          setIsReferenceMenuOpen((open) => !open);
                        }}
                        className="grid h-5 w-5 place-items-center rounded-lg bg-muted text-muted-foreground hover:text-foreground"
                        aria-label="Mention an uploaded image"
                        aria-expanded={isReferenceMenuOpen}
                        title="Mention an uploaded image"
                      >
                        <AtSign className="h-3.5 w-3.5" />
                      </button>
                      {isReferenceMenuOpen ? (
                        <div className="fixed left-6 top-[45vh] z-50 max-h-72 w-72 overflow-y-auto rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg">
                          {mentionableAssets.length ? (
                            <div className="grid gap-1">
                              {mentionableAssets.map((asset, index) => {
                                const source = asset.previewUrl || asset.url;
                                const selected = mentionedAssetIds.includes(
                                  asset.id,
                                );
                                return (
                                  <button
                                    key={asset.id}
                                    type="button"
                                    onClick={() =>
                                      toggleMentionedAsset(asset.id)
                                    }
                                    className={
                                      "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors " +
                                      (selected
                                        ? "bg-primary/15 text-foreground"
                                        : "hover:bg-muted")
                                    }
                                    aria-pressed={selected}
                                  >
                                    {source ? (
                                      <img
                                        src={source}
                                        alt=""
                                        className="h-8 w-8 shrink-0 rounded-md object-cover"
                                      />
                                    ) : (
                                      <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    )}
                                    <span className="min-w-0 truncate">
                                      Image {String(index + 1).padStart(2, "0")}{" "}
                                      · {asset.name}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="px-2 py-2 text-xs text-muted-foreground">
                              Upload an image first
                            </p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {prompt.length}/4000
                  </span>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:gap-5">
                <label className="grid min-w-0 gap-2 text-sm font-medium">
                  {t("controls.model") || "Model"}
                  <select
                    value={model}
                    onChange={(event) =>
                      setModel(event.target.value as ModelId)
                    }
                    className="h-10 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-ring"
                  >
                    <option value={autoBalancedModelId}>Auto · Balanced</option>
                    {models.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div
                  ref={formatPanelRef}
                  className="relative grid min-w-0 gap-2 text-sm font-medium"
                >
                  <span>{t("controls.format") || "Format"}</span>
                  <button
                    type="button"
                    onClick={() => setIsFormatOpen((open) => !open)}
                    className="flex h-10 w-full min-w-0 items-center justify-between gap-3 overflow-hidden rounded-xl border border-border bg-background px-3 text-left text-sm outline-none transition-colors hover:border-ring focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0 truncate">{formatSummary}</span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 transition-transform ${isFormatOpen ? "rotate-180" : ""}`}
                      aria-hidden="true"
                    />
                  </button>
                  {isFormatOpen ? (
                    <div className="absolute bottom-[calc(100%+0.5rem)] right-0 z-50 max-h-[min(70vh,28rem)] w-[min(calc(100vw-2rem),28rem)] overflow-y-auto rounded-2xl border border-border bg-card p-3 shadow-2xl sm:p-4">
                      <div className="space-y-2.5">
                        <div>
                          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                            Aspect Ratio
                          </p>
                          <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-muted/50 p-1.5">
                            {supportedAspectRatioOptions.map((option) => {
                              const active = aspectRatio === option.value;
                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() => setAspectRatio(option.value)}
                                  className={`grid min-h-16 place-items-center gap-1.5 rounded-lg px-2 py-2 transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}
                                >
                                  <span
                                    className={`rounded-[3px] border-2 ${option.shape} ${active ? "border-primary-foreground" : "border-muted-foreground"}`}
                                    aria-hidden="true"
                                  />
                                  <span className="text-xs font-semibold">
                                    {option.label}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div>
                          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                            Resolution
                          </p>
                          <div className="grid grid-cols-4 gap-1.5 rounded-xl bg-muted/50 p-1.5">
                            {qualityOptions.map((option) => (
                              <button
                                key={option}
                                type="button"
                                onClick={() => setQuality(option)}
                                className={`h-10 rounded-lg px-2 text-sm font-semibold transition-colors ${quality === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}
                              >
                                {option}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                            Length
                          </p>
                          {isContinuousDuration ? (
                            <div className="rounded-xl bg-muted/50 p-3">
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-xs text-muted-foreground">
                                  {minSelectableDuration}-
                                  {maxSelectableDuration}s
                                </span>
                                <label className="flex h-10 w-24 items-center overflow-hidden rounded-xl border border-border bg-background text-sm font-semibold focus-within:ring-2 focus-within:ring-ring">
                                  <input
                                    type="number"
                                    min={minSelectableDuration}
                                    max={maxSelectableDuration}
                                    step={1}
                                    value={durationSeconds}
                                    onChange={(event) =>
                                      setDurationSeconds(
                                        Number(event.currentTarget.value),
                                      )
                                    }
                                    className="h-full min-w-0 flex-1 bg-transparent px-2 text-right outline-none"
                                    aria-label="Video length in seconds"
                                  />
                                  <span className="pr-2 text-muted-foreground">
                                    s
                                  </span>
                                </label>
                              </div>
                              <input
                                type="range"
                                min={minSelectableDuration}
                                max={maxSelectableDuration}
                                step={1}
                                value={durationSeconds}
                                onChange={(event) =>
                                  setDurationSeconds(
                                    Number(event.currentTarget.value),
                                  )
                                }
                                className="mt-3 h-2 w-full cursor-pointer accent-primary"
                                aria-label="Video length in seconds"
                              />
                              <div className="mt-2 flex justify-between text-[10px] font-medium text-muted-foreground">
                                <span>{minSelectableDuration}s</span>
                                <span>{maxSelectableDuration}s</span>
                              </div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-4 gap-1.5 rounded-xl bg-muted/50 p-1.5">
                              {selectedModelConfig.supportedDurations.map(
                                (option) => {
                                  const active = duration === option;
                                  return (
                                    <button
                                      key={option}
                                      type="button"
                                      onClick={() => setDuration(option)}
                                      className={`h-10 rounded-lg px-2 text-sm font-semibold transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}
                                    >
                                      {option === "0s" ? "Original" : option}
                                    </button>
                                  );
                                },
                              )}
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                            Variations
                          </p>
                          <div className="grid grid-cols-4 gap-1.5 rounded-xl bg-muted/50 p-1.5">
                            {outputCountOptions.map((option) => (
                              <button
                                key={option}
                                type="button"
                                onClick={() => setOutputCount(option)}
                                className={`h-10 rounded-lg px-2 text-sm font-semibold transition-colors ${outputCount === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}
                              >
                                {option}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              {error ? (
                <p
                  className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
                  aria-live="polite"
                >
                  {error}
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => void createVideo()}
                disabled={isRunning}
                className="mt-auto flex h-11 w-full items-center justify-center gap-3 rounded-xl bg-[#D97757] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#C96848] disabled:cursor-not-allowed disabled:!opacity-100 disabled:bg-[#DCA28E]"
              >
                <WandSparkles className="h-5 w-5" />
                {isRunning
                  ? t("create.preparing") || "Preparing..."
                  : t("create.button") || "Generate Video"}
              </button>
            </div>
          </section>

          <section className="flex h-full flex-col rounded-2xl border border-border bg-card p-3 shadow-sm">
            {!hasStartedGeneration ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="w-16 h-16 rounded-2xl bg-muted text-muted-foreground flex items-center justify-center mb-4">
                  <Play className="h-8 w-8" />
                </div>
                <p className="text-foreground font-medium mb-1">
                  {t("emptyHint") || "Generated video will appear here"}
                </p>
                <p className="text-sm text-muted-foreground">
                  Enter a prompt on the left and click generate to start.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-background p-4">
                <h3 className="font-semibold">Generation status</h3>
                {variants.map((variant) => (
                  <div
                    key={variant.id}
                    className="mt-3 text-sm text-muted-foreground"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span>{variant.error || variant.notes}</span>
                      <span className="shrink-0">{variant.status}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-primary transition-all"
                        style={{ width: `${variant.progress}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs font-medium text-foreground">
                      {variant.label}
                    </p>
                    {variant.providerTaskId ? (
                      <p className="mt-2 break-all text-xs">
                        {variant.providerTaskId}
                      </p>
                    ) : null}
                    {variant.videoUrl ? (
                      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-black">
                        <video
                          className="aspect-video w-full object-contain"
                          src={variant.videoUrl}
                          controls
                          playsInline
                        />
                        <div className="flex items-center justify-between gap-3 bg-background px-3 py-2">
                          <span className="text-xs text-muted-foreground">
                            {variant.label}
                          </span>
                          <a
                            className="text-xs font-semibold text-primary underline-offset-4 hover:underline"
                            href={variant.videoUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open video
                          </a>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
