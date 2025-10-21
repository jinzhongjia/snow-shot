"use client";

import { convertFileSrc } from "@tauri-apps/api/core";
import type * as PIXI from "pixi.js";
import type React from "react";
import {
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { defaultWatermarkProps } from "@/pages/draw/components/drawToolbar/components/tools/drawExtraTool/components/watermarkTool";
import type { CaptureBoundingBoxInfo } from "@/pages/draw/extra";
import type { ImageSharedBufferData } from "@/pages/draw/tools";
import type { ElementRect, ImageBuffer } from "@/types/commands/screenshot";
import type { CaptureHistoryItem } from "@/utils/appStore";
import { getCaptureHistoryImageAbsPath } from "@/utils/captureHistory";
import { supportOffscreenCanvas } from "@/utils/environment";
import { appError, appInfo } from "@/utils/log";
import {
	addImageToContainerAction,
	canvasRenderAction,
	clearCanvasAction,
	clearContainerAction,
	clearContextAction,
	createBlurSpriteAction,
	createNewCanvasContainerAction,
	deleteBlurSpriteAction,
	disposeCanvasAction,
	getImageDataAction,
	INIT_CONTAINER_KEY,
	initBaseImageTextureAction,
	initCanvasAction,
	renderToCanvasAction,
	renderToPngAction,
	resizeCanvasAction,
	updateBlurSpriteAction,
	updateHighlightAction,
	updateHighlightElementAction,
	updateWatermarkSpriteAction,
} from "./actions";
import type {
	BlurSprite,
	BlurSpriteProps,
	HighlightElement,
	HighlightElementProps,
	HighlightProps,
	WatermarkProps,
} from "./baseLayerRenderActions";

export type ImageLayerActionType = {
	/**
	 * 初始化画布
	 */
	initCanvas: (antialias: boolean) => Promise<void>;
	resizeCanvas: (width: number, height: number) => void;
	clearCanvas: () => Promise<void>;
	getLayerContainerElement: () => HTMLDivElement | null;
	changeCursor: (cursor: Required<React.CSSProperties>["cursor"]) => string;
	getImageData: (
		selectRect: ElementRect | undefined,
	) => Promise<ImageData | undefined>;
	renderToPng: (
		selectRect: ElementRect,
		containerId: string | undefined,
	) => Promise<ArrayBuffer | undefined>;
	/**
	 * 渲染画布
	 */
	renderToCanvas: (
		selectRect: ElementRect,
		containerId: string | undefined,
	) => Promise<PIXI.ICanvas | undefined>;
	/**
	 * 渲染画布
	 */
	canvasRender: () => Promise<void>;
	/**
	 * 添加图片到画布容器
	 */
	addImageToContainer: (
		containerKey: string,
		imageSrc: string | ImageSharedBufferData | { type: "base_image_texture" },
		hideImageSprite?: boolean,
	) => Promise<void>;
	/**
	 * 清空画布容器
	 */
	clearContainer: (containerKey: string) => Promise<void>;
	/**
	 * 创建模糊效果
	 */
	createBlurSprite: (
		blurContainerKey: string,
		blurElementId: string,
	) => Promise<void>;
	/**
	 * 更新模糊效果
	 */
	updateBlurSprite: (
		blurElementId: string,
		blurProps: BlurSpriteProps,
		updateFilter: boolean,
	) => Promise<void>;
	/**
	 * 更新水印效果
	 */
	updateWatermarkSprite: (watermarkProps: WatermarkProps) => Promise<void>;
	/**
	 * 删除模糊效果
	 */
	deleteBlurSprite: (blurElementId: string) => Promise<void>;
	/**
	 * 更新 highlight 元素
	 */
	updateHighlightElement: (
		highlightContainerKey: string,
		highlightElementId: string,
		highlightElementProps: HighlightElementProps | undefined,
	) => Promise<void>;
	/**
	 * 重新渲染 highlight
	 */
	updateHighlight: (
		highlightContainerKey: string,
		highlightProps: HighlightProps,
	) => Promise<void>;
	/**
	 * 清除现有的状态
	 */
	clearContext: () => Promise<void>;
	switchCaptureHistory: (item: CaptureHistoryItem | undefined) => Promise<void>;
	setEnable: (enable: boolean) => void;
	/**
	 * 执行截图
	 */
	onExecuteScreenshot: () => Promise<void>;
	/**
	 * 截图准备
	 */
	onCaptureReady: (
		imageSrc: string | undefined,
		imageBuffer:
			| ImageBuffer
			| ImageSharedBufferData
			| { type: "base_image_texture" }
			| undefined,
		hideImageSprite?: boolean,
	) => Promise<void>;
	/**
	 * 显示器信息准备
	 */
	onCaptureBoundingBoxInfoReady: (
		width: number,
		height: number,
	) => Promise<void>;
	/**
	 * 截图加载完成
	 */
	onCaptureLoad: (
		imageSrc: string | undefined,
		imageBuffer: ImageBuffer | ImageSharedBufferData | undefined,
		captureBoundingBoxInfo: CaptureBoundingBoxInfo,
	) => Promise<void>;
	/**
	 * 截图完成
	 */
	onCaptureFinish: () => Promise<void>;
	/**
	 * 初始化临时图片纹理
	 */
	initBaseImageTexture: (
		imageUrl: string,
	) => Promise<{ width: number; height: number }>;
};

export type ImageLayerProps = {
	zIndex: number;
	onInitCanvasReady: () => Promise<void>;
	actionRef: React.RefObject<ImageLayerActionType | undefined>;
	disabled?: boolean;
};

export const DRAW_LAYER_BLUR_CONTAINER_KEY = "draw_layer_blur_container";
export const DRAW_LAYER_HIGHLIGHT_CONTAINER_KEY =
	"draw_layer_highlight_container";
export const DRAW_LAYER_WATERMARK_CONTAINER_KEY =
	"draw_layer_watermark_container";

export const ImageLayer: React.FC<ImageLayerProps> = ({
	zIndex,
	onInitCanvasReady,
	actionRef,
	disabled,
}) => {
	const layerContainerElementRef = useRef<HTMLDivElement>(null);
	/** 可能的 OffscreenCanvas，用于在 Web Worker 中渲染 */
	const offscreenCanvasRef = useRef<OffscreenCanvas | undefined>(undefined);
	const canvasAppRef = useRef<PIXI.Application | undefined>(undefined);
	const baseImageTextureRef = useRef<PIXI.Texture | undefined>(undefined);
	const canvasContainerMapRef = useRef<Map<string, PIXI.Container>>(new Map());
	const canvasContainerChildCountRef = useRef<number>(0);
	const currentImageTextureRef = useRef<PIXI.Texture | undefined>(undefined);
	const blurSpriteMapRef = useRef<Map<string, BlurSprite>>(new Map());
	const highlightElementMapRef = useRef<Map<string, HighlightElement>>(
		new Map(),
	);
	const lastWatermarkPropsRef = useRef<WatermarkProps>(defaultWatermarkProps);
	const [rendererWorker, setRendererWorker] = useState<Worker | undefined>(
		undefined,
	);
	const [hasInitRendererWorker, setHasInitRendererWorker] = useState(false);

	useEffect(() => {
		const worker = supportOffscreenCanvas()
			? new Worker(new URL("./workers/renderWorker.ts", import.meta.url))
			: undefined;
		setRendererWorker(worker);
		setHasInitRendererWorker(true);
		return () => {
			worker?.terminate();
		};
	}, []);

	/** 创建一个新的画布容器 */
	const createNewCanvasContainer = useCallback(
		async (containerKey: string): Promise<string | undefined> => {
			return await createNewCanvasContainerAction(
				rendererWorker,
				canvasAppRef,
				canvasContainerMapRef,
				containerKey,
			);
		},
		[rendererWorker],
	);

	const disposeCanvas = useCallback(async () => {
		await disposeCanvasAction(rendererWorker, canvasAppRef);
	}, [rendererWorker]);

	const initBaseImageTexture = useCallback<
		ImageLayerActionType["initBaseImageTexture"]
	>(
		async (imageUrl: string) => {
			return await initBaseImageTextureAction(
				rendererWorker,
				baseImageTextureRef,
				imageUrl,
			);
		},
		[rendererWorker],
	);
	/** 初始化画布 */
	const initCanvas = useCallback<ImageLayerActionType["initCanvas"]>(
		async (antialias: boolean) => {
			if (disabled) {
				return;
			}

			if (!hasInitRendererWorker) {
				return;
			}

			const canvas = document.createElement("canvas");
			if (layerContainerElementRef.current) {
				if (layerContainerElementRef.current.firstChild) {
					layerContainerElementRef.current.removeChild(
						layerContainerElementRef.current.firstChild,
					);
				}
				layerContainerElementRef.current.appendChild(canvas);
			}

			offscreenCanvasRef.current = supportOffscreenCanvas()
				? canvas.transferControlToOffscreen()
				: undefined;

			const initOptions: Partial<PIXI.ApplicationOptions> = {
				backgroundAlpha: 0,
				eventFeatures: {
					move: false,
					globalMove: false,
					click: false,
					wheel: false,
				},
				autoStart: false,
				antialias,
				canvas: offscreenCanvasRef.current ?? canvas,
				preference: "webgl",
			};

			await initCanvasAction(
				rendererWorker,
				canvasAppRef,
				initOptions,
				offscreenCanvasRef.current ? [offscreenCanvasRef.current] : undefined,
			);

			await onInitCanvasReady?.();
		},
		[rendererWorker, onInitCanvasReady, disabled, hasInitRendererWorker],
	);

	useEffect(() => {
		initCanvas(true);
	}, [initCanvas]);

	/** 调整画布大小 */
	const resizeCanvas = useCallback(
		async (width: number, height: number) => {
			await createNewCanvasContainer(INIT_CONTAINER_KEY);
			await resizeCanvasAction(rendererWorker, canvasAppRef, width, height);
		},
		[createNewCanvasContainer, rendererWorker],
	);

	const clearCanvas = useCallback<
		ImageLayerActionType["clearCanvas"]
	>(async () => {
		await clearCanvasAction(
			rendererWorker,
			canvasAppRef,
			canvasContainerMapRef,
			canvasContainerChildCountRef,
		);
	}, [rendererWorker]);

	const changeCursor = useCallback<ImageLayerActionType["changeCursor"]>(
		(cursor) => {
			if (!layerContainerElementRef.current) {
				return "auto";
			}

			const previousCursor = layerContainerElementRef.current.style.cursor;
			layerContainerElementRef.current.style.cursor = cursor;
			return previousCursor;
		},
		[],
	);

	const getLayerContainerElement = useCallback<
		ImageLayerActionType["getLayerContainerElement"]
	>(() => layerContainerElementRef.current, []);

	const getImageData = useCallback<ImageLayerActionType["getImageData"]>(
		async (selectRect: ElementRect | undefined) => {
			return getImageDataAction(
				rendererWorker,
				canvasAppRef,
				canvasContainerMapRef,
				INIT_CONTAINER_KEY,
				selectRect,
			);
		},
		[rendererWorker],
	);

	const renderToPng = useCallback<ImageLayerActionType["renderToPng"]>(
		async (selectRect: ElementRect, containerId: string | undefined) => {
			return renderToPngAction(
				rendererWorker,
				canvasAppRef,
				canvasContainerMapRef,
				INIT_CONTAINER_KEY,
				selectRect,
				containerId,
			);
		},
		[rendererWorker],
	);

	const renderToCanvas = useCallback<ImageLayerActionType["renderToCanvas"]>(
		async (selectRect: ElementRect, containerId: string | undefined) => {
			return renderToCanvasAction(
				rendererWorker,
				canvasAppRef,
				canvasContainerMapRef,
				INIT_CONTAINER_KEY,
				selectRect,
				containerId,
			);
		},
		[rendererWorker],
	);

	const canvasRender = useCallback<
		ImageLayerActionType["canvasRender"]
	>(async () => {
		await canvasRenderAction(rendererWorker, canvasAppRef);
	}, [rendererWorker]);

	const addImageToContainer = useCallback<
		ImageLayerActionType["addImageToContainer"]
	>(
		async (containerKey, imageSrc, hideImageSprite) => {
			await addImageToContainerAction(
				rendererWorker,
				canvasContainerMapRef,
				currentImageTextureRef,
				baseImageTextureRef,
				containerKey,
				imageSrc,
				hideImageSprite,
			);
		},
		[rendererWorker],
	);

	const clearContainer = useCallback<ImageLayerActionType["clearContainer"]>(
		async (containerKey: string) => {
			await clearContainerAction(
				rendererWorker,
				canvasContainerMapRef,
				containerKey,
			);
		},
		[rendererWorker],
	);

	const createBlurSprite = useCallback<
		ImageLayerActionType["createBlurSprite"]
	>(
		async (blurContainerKey: string, blurElementId: string) => {
			await createBlurSpriteAction(
				rendererWorker,
				canvasContainerMapRef,
				currentImageTextureRef,
				blurSpriteMapRef,
				blurContainerKey,
				blurElementId,
			);
		},
		[rendererWorker],
	);

	const updateBlurSprite = useCallback<
		ImageLayerActionType["updateBlurSprite"]
	>(
		async (
			blurElementId: string,
			blurProps: BlurSpriteProps,
			updateFilter: boolean,
		) => {
			await updateBlurSpriteAction(
				rendererWorker,
				blurSpriteMapRef,
				blurElementId,
				blurProps,
				updateFilter,
				window.devicePixelRatio,
			);
		},
		[rendererWorker],
	);

	const deleteBlurSprite = useCallback<
		ImageLayerActionType["deleteBlurSprite"]
	>(
		async (blurElementId: string) => {
			await deleteBlurSpriteAction(
				rendererWorker,
				blurSpriteMapRef,
				blurElementId,
			);
		},
		[rendererWorker],
	);

	const updateWatermarkSprite = useCallback<
		ImageLayerActionType["updateWatermarkSprite"]
	>(
		async (watermarkProps: WatermarkProps) => {
			await updateWatermarkSpriteAction(
				rendererWorker,
				canvasAppRef,
				canvasContainerMapRef,
				lastWatermarkPropsRef,
				DRAW_LAYER_WATERMARK_CONTAINER_KEY,
				watermarkProps,
				window.devicePixelRatio,
			);
		},
		[rendererWorker],
	);

	const updateHighlightElement = useCallback<
		ImageLayerActionType["updateHighlightElement"]
	>(
		async (
			highlightContainerKey: string,
			highlightElementId: string,
			highlightElementProps: HighlightElementProps | undefined,
		) => {
			await updateHighlightElementAction(
				rendererWorker,
				canvasContainerMapRef,
				highlightElementMapRef,
				highlightContainerKey,
				highlightElementId,
				highlightElementProps,
				window.devicePixelRatio,
			);
		},
		[rendererWorker],
	);

	const updateHighlight = useCallback<ImageLayerActionType["updateHighlight"]>(
		async (highlightContainerKey: string, highlightProps: HighlightProps) => {
			await updateHighlightAction(
				rendererWorker,
				canvasContainerMapRef,
				highlightElementMapRef,
				highlightContainerKey,
				highlightProps,
			);
		},
		[rendererWorker],
	);

	const clearContext = useCallback<
		ImageLayerActionType["clearContext"]
	>(async () => {
		await clearContextAction(
			rendererWorker,
			blurSpriteMapRef,
			highlightElementMapRef,
			lastWatermarkPropsRef,
		);
	}, [rendererWorker]);

	useEffect(() => {
		return () => {
			disposeCanvas();
		};
	}, [disposeCanvas]);

	const currentCaptureImageSrcRef = useRef<
		string | ImageSharedBufferData | undefined
	>(undefined);
	const blurContainerKeyRef = useRef<string | undefined>(undefined);
	const highlightContainerKeyRef = useRef<string | undefined>(undefined);
	const watermarkContainerKeyRef = useRef<string | undefined>(undefined);
	/*
	 * 初始化截图
	 */
	const onCaptureReady = useCallback<ImageLayerActionType["onCaptureReady"]>(
		async (
			imageSrc: string | undefined,
			imageBuffer:
				| ImageBuffer
				| ImageSharedBufferData
				| { type: "base_image_texture" }
				| undefined,
			hideImageSprite?: boolean,
		): Promise<void> => {
			// 底图作为单独的层级显示
			const isSharedBuffer = imageBuffer && "sharedBuffer" in imageBuffer;
			currentCaptureImageSrcRef.current = isSharedBuffer
				? imageBuffer
				: imageSrc;
			// 可能是切换截图历史，这种情况下不存在截图数据
			if (imageSrc) {
				await addImageToContainer(
					INIT_CONTAINER_KEY,
					imageSrc,
					hideImageSprite,
				);
			} else if (isSharedBuffer) {
				await addImageToContainer(
					INIT_CONTAINER_KEY,
					imageBuffer,
					hideImageSprite,
				);
			} else if (
				imageBuffer &&
				"type" in imageBuffer &&
				imageBuffer.type === "base_image_texture"
			) {
				await addImageToContainer(
					INIT_CONTAINER_KEY,
					imageBuffer,
					hideImageSprite,
				);
			} else {
				appError("[ImageLayer] imageBuffer is not supported", imageBuffer);
			}
			// 水印层
			watermarkContainerKeyRef.current = await createNewCanvasContainer(
				DRAW_LAYER_WATERMARK_CONTAINER_KEY,
			);
			// 模糊层
			blurContainerKeyRef.current = await createNewCanvasContainer(
				DRAW_LAYER_BLUR_CONTAINER_KEY,
			);
			// 高亮层
			highlightContainerKeyRef.current = await createNewCanvasContainer(
				DRAW_LAYER_HIGHLIGHT_CONTAINER_KEY,
			);

			await canvasRender();
		},
		[createNewCanvasContainer, canvasRender, addImageToContainer],
	);

	const onCaptureFinish = useCallback<
		ImageLayerActionType["onCaptureFinish"]
	>(async () => {
		await clearCanvas();
	}, [clearCanvas]);

	const onExecuteScreenshot = useCallback<
		ImageLayerActionType["onExecuteScreenshot"]
	>(async () => {}, []);

	const onCaptureBoundingBoxInfoReady = useCallback<
		ImageLayerActionType["onCaptureBoundingBoxInfoReady"]
	>(
		async (
			...args: Parameters<ImageLayerActionType["onCaptureBoundingBoxInfoReady"]>
		) => {
			const [width, height] = args;

			// 将画布调整为截图大小
			await resizeCanvas(width, height);
		},
		[resizeCanvas],
	);

	const onCaptureLoad = useCallback<
		ImageLayerActionType["onCaptureLoad"]
	>(async () => {}, []);

	const switchCaptureHistory = useCallback(
		async (item: CaptureHistoryItem | undefined) => {
			if (!item) {
				if (currentCaptureImageSrcRef.current) {
					await addImageToContainer(
						INIT_CONTAINER_KEY,
						currentCaptureImageSrcRef.current,
					);
				}
			} else {
				const fileUri = convertFileSrc(
					await getCaptureHistoryImageAbsPath(item.file_name),
				);
				await addImageToContainer(INIT_CONTAINER_KEY, fileUri);
			}

			// 移除之前显示的已有内容
			await Promise.all([
				clearContext(),
				clearContainer(DRAW_LAYER_HIGHLIGHT_CONTAINER_KEY),
				clearContainer(DRAW_LAYER_BLUR_CONTAINER_KEY),
				clearContainer(DRAW_LAYER_WATERMARK_CONTAINER_KEY),
			]);

			await canvasRender();
		},
		[addImageToContainer, canvasRender, clearContainer, clearContext],
	);

	const [enable, setEnable] = useState(false);

	useEffect(() => {
		if (!layerContainerElementRef.current) {
			return;
		}

		if (enable) {
			layerContainerElementRef.current.style.pointerEvents = "auto";
		} else {
			layerContainerElementRef.current.style.pointerEvents = "none";
		}
	}, [enable]);

	useImperativeHandle(
		actionRef,
		() => ({
			resizeCanvas,
			clearCanvas,
			getLayerContainerElement,
			createNewCanvasContainer,
			getImageData,
			renderToPng,
			renderToCanvas,
			initCanvas,
			changeCursor,
			canvasRender,
			addImageToContainer,
			clearContainer,
			createBlurSprite,
			updateBlurSprite,
			deleteBlurSprite,
			updateWatermarkSprite,
			updateHighlightElement,
			updateHighlight,
			clearContext,
			switchCaptureHistory,
			setEnable,
			onExecuteScreenshot,
			onCaptureReady,
			onCaptureFinish,
			onCaptureBoundingBoxInfoReady,
			onCaptureLoad,
			initBaseImageTexture,
		}),
		[
			resizeCanvas,
			clearCanvas,
			getLayerContainerElement,
			createNewCanvasContainer,
			getImageData,
			renderToCanvas,
			renderToPng,
			initCanvas,
			changeCursor,
			canvasRender,
			addImageToContainer,
			clearContainer,
			createBlurSprite,
			updateBlurSprite,
			deleteBlurSprite,
			updateWatermarkSprite,
			updateHighlightElement,
			updateHighlight,
			clearContext,
			switchCaptureHistory,
			onCaptureFinish,
			onCaptureBoundingBoxInfoReady,
			onExecuteScreenshot,
			onCaptureReady,
			onCaptureLoad,
			initBaseImageTexture,
		],
	);

	return (
		<>
			<div
				className="base-layer"
				ref={layerContainerElementRef}
				style={{ zIndex }}
			/>

			<style jsx>
				{`
                .base-layer {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                }

                .base-layer :global(canvas) {
                    width: 100%;
                    height: 100%;
                }`}
			</style>
		</>
	);
};
