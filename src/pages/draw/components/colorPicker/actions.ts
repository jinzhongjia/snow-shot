import type { ImageBuffer } from "@/types/commands/screenshot";
import { appWarn } from "@/utils/log";
import type { ImageSharedBufferData } from "../../tools";
import type { RefType } from "../drawLayer/baseLayerRenderActions";
import {
	renderGetPreviewImageDataAction,
	renderInitImageDataAction,
	renderInitPreviewCanvasAction,
	renderPickColorAction,
	renderPixelsWorkerTerminateAction,
	renderPutImageDataAction,
	renderSwitchCaptureHistoryAction,
} from "./renderActions";
import {
	type ColorPickerRenderGetPreviewImageDataData,
	type ColorPickerRenderGetPreviewImageDataResult,
	type ColorPickerRenderInitImageDataData,
	type ColorPickerRenderInitImageDataResult,
	type ColorPickerRenderInitPreviewCanvasData,
	type ColorPickerRenderInitPreviewCanvasResult,
	ColorPickerRenderMessageType,
	type ColorPickerRenderPickColorData,
	type ColorPickerRenderPickColorResult,
	type ColorPickerRenderPutImageDataData,
	type ColorPickerRenderPutImageDataResult,
	type ColorPickerRenderSwitchCaptureHistoryData,
	type ColorPickerRenderSwitchCaptureHistoryResult,
} from "./workers/renderWorkerTypes";

export const initPreviewCanvasAction = async (
	renderWorker: Worker | undefined,
	previewCanvasRef: RefType<OffscreenCanvas | HTMLCanvasElement | null>,
	previewCanvas: HTMLCanvasElement | OffscreenCanvas,
	previewOffscreenCanvasRef: RefType<OffscreenCanvas | null>,
	previewCanvasCtxRef: RefType<
		OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
	>,
	decoderWasmModuleArrayBufferRef: RefType<ArrayBuffer | null>,
	decoderWasmModuleArrayBuffer: ArrayBuffer,
	transfer: Transferable[] | undefined,
) => {
	return new Promise((resolve) => {
		if (renderWorker) {
			if (!previewOffscreenCanvasRef.current) {
				appWarn(
					"[initPreviewCanvasAction] previewOffscreenCanvasRef.current is null",
				);
				return;
			}
			const InitPreviewCanvasData: ColorPickerRenderInitPreviewCanvasData = {
				type: ColorPickerRenderMessageType.InitPreviewCanvas,
				payload: {
					previewCanvas: previewOffscreenCanvasRef.current,
					decoderWasmModuleArrayBuffer: decoderWasmModuleArrayBuffer,
				},
			};

			const handleMessage = (
				event: MessageEvent<ColorPickerRenderInitPreviewCanvasResult>,
			) => {
				const { type, payload } = event.data;
				if (type === ColorPickerRenderMessageType.InitPreviewCanvas) {
					resolve(payload);
					renderWorker.removeEventListener("message", handleMessage);
				}
			};

			renderWorker.addEventListener("message", handleMessage);

			if (transfer) {
				renderWorker.postMessage(InitPreviewCanvasData, transfer);
			} else {
				renderWorker.postMessage(InitPreviewCanvasData);
			}
		} else {
			renderInitPreviewCanvasAction(
				previewCanvasRef,
				previewCanvas,
				previewCanvasCtxRef,
				decoderWasmModuleArrayBufferRef,
				decoderWasmModuleArrayBuffer,
			);
			resolve(undefined);
		}
	});
};

export const initImageDataAction = async (
	renderWorker: Worker | undefined,
	previewCanvasRef: RefType<OffscreenCanvas | HTMLCanvasElement | null>,
	previewImageDataRef: RefType<ImageData | null>,
	decoderWasmModuleArrayBufferRef: RefType<ArrayBuffer | null>,
	imageBuffer: ImageBuffer | ImageSharedBufferData,
) => {
	return new Promise((resolve) => {
		if (renderWorker) {
			const InitImageDataData: ColorPickerRenderInitImageDataData = {
				type: ColorPickerRenderMessageType.InitImageData,
				payload: {
					imageBuffer:
						"sharedBuffer" in imageBuffer ? imageBuffer : imageBuffer.buffer,
				},
			};

			const handleMessage = (
				event: MessageEvent<ColorPickerRenderInitImageDataResult>,
			) => {
				const { type, payload } = event.data;
				if (type === ColorPickerRenderMessageType.InitImageData) {
					resolve(payload);
					renderWorker.removeEventListener("message", handleMessage);
				}
			};

			renderWorker.addEventListener("message", handleMessage);

			renderWorker.postMessage(InitImageDataData);
		} else {
			renderInitImageDataAction(
				previewCanvasRef,
				previewImageDataRef,
				decoderWasmModuleArrayBufferRef,
				"sharedBuffer" in imageBuffer ? imageBuffer : imageBuffer.buffer,
			).then(() => {
				resolve(undefined);
			});
		}
	});
};

export const putImageDataAction = async (
	renderWorker: Worker | undefined,
	previewCanvasCtxRef: RefType<
		OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
	>,
	previewImageDataRef: RefType<ImageData | null>,
	captureHistoryImageDataRef: RefType<ImageData | undefined>,
	x: number,
	y: number,
	colorX: number,
	colorY: number,
	centerAuxiliaryLineColor: string | undefined,
): Promise<{ color: [red: number, green: number, blue: number] }> => {
	return new Promise((resolve) => {
		if (renderWorker) {
			const PutImageDataData: ColorPickerRenderPutImageDataData = {
				type: ColorPickerRenderMessageType.PutImageData,
				payload: {
					x,
					y,
					colorX,
					colorY,
					centerAuxiliaryLineColor,
				},
			};

			const handleMessage = (
				event: MessageEvent<ColorPickerRenderPutImageDataResult>,
			) => {
				const { type, payload } = event.data;
				if (type === ColorPickerRenderMessageType.PutImageData) {
					resolve(payload);
					renderWorker.removeEventListener("message", handleMessage);
				}
			};

			renderWorker.addEventListener("message", handleMessage);

			renderWorker.postMessage(PutImageDataData);
		} else {
			const color = renderPutImageDataAction(
				previewCanvasCtxRef,
				previewImageDataRef,
				captureHistoryImageDataRef,
				x,
				y,
				colorX,
				colorY,
				centerAuxiliaryLineColor,
			);
			resolve(color);
		}
	});
};

export const getPreviewImageDataAction = async (
	renderWorker: Worker | undefined,
	previewImageDataRef: RefType<ImageData | null>,
	captureHistoryImageDataRef: RefType<ImageData | undefined>,
): Promise<ImageData | null> => {
	return new Promise((resolve) => {
		if (renderWorker) {
			const GetPreviewImageDataData: ColorPickerRenderGetPreviewImageDataData =
				{
					type: ColorPickerRenderMessageType.GetPreviewImageData,
					payload: undefined,
				};

			const handleMessage = (
				event: MessageEvent<ColorPickerRenderGetPreviewImageDataResult>,
			) => {
				const { type, payload } = event.data;
				if (type === ColorPickerRenderMessageType.GetPreviewImageData) {
					resolve(payload.imageData);
					renderWorker.removeEventListener("message", handleMessage);
				}
			};

			renderWorker.addEventListener("message", handleMessage);

			renderWorker.postMessage(GetPreviewImageDataData);
		} else {
			const imageData = renderGetPreviewImageDataAction(
				previewImageDataRef,
				captureHistoryImageDataRef,
			);
			resolve(imageData);
		}
	});
};

export const switchCaptureHistoryAction = async (
	renderWorker: Worker | undefined,
	decoderWasmModuleArrayBufferRef: RefType<ArrayBuffer | null>,
	captureHistoryImageDataRef: RefType<ImageData | undefined>,
	imageSrc: string | undefined,
): Promise<void> => {
	return new Promise((resolve) => {
		if (renderWorker) {
			const SwitchCaptureHistoryData: ColorPickerRenderSwitchCaptureHistoryData =
				{
					type: ColorPickerRenderMessageType.SwitchCaptureHistory,
					payload: {
						imageSrc,
					},
				};

			const handleMessage = (
				event: MessageEvent<ColorPickerRenderSwitchCaptureHistoryResult>,
			) => {
				const { type, payload } = event.data;
				if (type === ColorPickerRenderMessageType.SwitchCaptureHistory) {
					resolve(payload);
					renderWorker.removeEventListener("message", handleMessage);
				}
			};

			renderWorker.addEventListener("message", handleMessage);

			renderWorker.postMessage(SwitchCaptureHistoryData);
		} else {
			renderSwitchCaptureHistoryAction(
				decoderWasmModuleArrayBufferRef,
				captureHistoryImageDataRef,
				imageSrc,
			).then(() => {
				resolve(undefined);
			});
		}
	});
};

export const pickColorAction = async (
	renderWorker: Worker | undefined,
	captureHistoryImageDataRef: RefType<ImageData | undefined>,
	previewImageDataRef: RefType<ImageData | null>,
	x: number,
	y: number,
): Promise<{ color: [red: number, green: number, blue: number] }> => {
	return new Promise((resolve) => {
		if (renderWorker) {
			const PickColorData: ColorPickerRenderPickColorData = {
				type: ColorPickerRenderMessageType.PickColor,
				payload: {
					x,
					y,
				},
			};

			const handleMessage = (
				event: MessageEvent<ColorPickerRenderPickColorResult>,
			) => {
				const { type, payload } = event.data;
				if (type === ColorPickerRenderMessageType.PickColor) {
					resolve(payload);
					renderWorker.removeEventListener("message", handleMessage);
				}
			};
			renderWorker.addEventListener("message", handleMessage);

			renderWorker.postMessage(PickColorData);
		} else {
			const color = renderPickColorAction(
				captureHistoryImageDataRef,
				previewImageDataRef,
				x,
				y,
			);
			resolve(color);
		}
	});
};

export const terminateWorkerAction = async () => {
	renderPixelsWorkerTerminateAction();
};
