import type {
	NonDeletedExcalidrawElement,
	Ordered,
} from "@mg-chao/excalidraw/element/types";
import type { AppState } from "@mg-chao/excalidraw/types";
import React, {
	useCallback,
	useContext,
	useImperativeHandle,
	useRef,
} from "react";
import { FormattedMessage } from "react-intl";
import { captureFullScreen } from "@/commands/screenshot";
import { DrawStatePublisher } from "@/components/drawCore/extra";
import { AntdContext } from "@/contexts/antdContext";
import { AppSettingsPublisher } from "@/contexts/appSettingsActionContext";
import { onCaptureHistoryChange } from "@/functions/screenshot";
import { useAppSettingsLoad } from "@/hooks/useAppSettingsLoad";
import { withStatePublisher } from "@/hooks/useStatePublisher";
import { useStateSubscriber } from "@/hooks/useStateSubscriber";
import { type AppSettingsData, AppSettingsGroup } from "@/types/appSettings";
import type {
	CaptureFullScreenResult,
	ElementRect,
	ImageBuffer,
} from "@/types/commands/screenshot";
import { DrawToolbarKeyEventKey } from "@/types/components/drawToolbar";
import { DrawState } from "@/types/draw";
import { getCorrectHdrColorAlgorithm } from "@/utils/appSettings";
import {
	type CaptureHistoryItem,
	CaptureHistorySource,
} from "@/utils/appStore";
import { playCameraShutterSound } from "@/utils/audio";
import {
	CaptureHistory,
	getCaptureHistoryImageAbsPath,
} from "@/utils/captureHistory";
import { getImagePathFromSettings } from "@/utils/file";
import { appError } from "@/utils/log";
import { ScreenshotType } from "@/utils/types";
import {
	CaptureEvent,
	type CaptureEventParams,
	CaptureEventPublisher,
	DrawEvent,
	DrawEventPublisher,
	ScreenshotTypePublisher,
} from "../../extra";
import type { ImageSharedBufferData } from "../../tools";
import { DrawContext } from "../../types";
import { KeyEventWrap } from "../drawToolbar/components/keyEventWrap";
import { EnableKeyEventPublisher } from "../drawToolbar/components/keyEventWrap/extra";
import { encodeImage } from "./workers/encodeImage";

export type CaptureHistoryActionType = {
	saveCurrentCapture: (
		imageBuffer: ImageBuffer | ImageSharedBufferData | CaptureHistoryItem,
		selectRect: ElementRect | undefined,
		excalidrawElements:
			| readonly Ordered<NonDeletedExcalidrawElement>[]
			| undefined,
		appState: Readonly<AppState> | undefined,
		captureResult?: ArrayBuffer,
		source?: CaptureHistorySource,
	) => Promise<void>;
	switch: (captureHistoryId: string) => Promise<void>;
	captureFullScreen: () => Promise<void>;
	getCurrentIndex: () => number;
	getCurrentCaptureHistoryItem: () => CaptureHistoryItem | undefined;
};

const CaptureHistoryControllerCore: React.FC<{
	actionRef: React.RefObject<CaptureHistoryActionType | undefined>;
}> = ({ actionRef }) => {
	const captureHistoryListRef = useRef<CaptureHistoryItem[]>([]);
	const currentIndexRef = useRef<number>(0);
	const captureHistoryRef = useRef<CaptureHistory | undefined>(undefined);
	const isImageLoadingRef = useRef<boolean>(false);
	const [getScreenshotType] = useStateSubscriber(
		ScreenshotTypePublisher,
		undefined,
	);
	const [, setEnableKeyEvent] = useStateSubscriber(
		EnableKeyEventPublisher,
		undefined,
	);
	const {
		selectLayerActionRef,
		imageLayerActionRef,
		drawLayerActionRef,
		colorPickerActionRef,
	} = useContext(DrawContext);

	const resetCurrentIndex = useCallback(() => {
		currentIndexRef.current = captureHistoryListRef.current.length;
	}, []);

	const [getAppSettings] = useStateSubscriber(AppSettingsPublisher, undefined);
	const reloadCaptureHistoryList = useCallback(
		async (appSettings?: AppSettingsData) => {
			if (!captureHistoryRef.current) {
				return;
			}

			captureHistoryListRef.current = await captureHistoryRef.current.getList(
				appSettings ?? getAppSettings(),
			);
			resetCurrentIndex();
		},
		[resetCurrentIndex, getAppSettings],
	);
	const init = useCallback(
		async (appSettings: AppSettingsData) => {
			if (captureHistoryRef.current?.inited()) {
				return;
			}

			captureHistoryRef.current = new CaptureHistory();
			await captureHistoryRef.current.init();

			reloadCaptureHistoryList(appSettings);
		},
		[reloadCaptureHistoryList],
	);

	useStateSubscriber(
		CaptureEventPublisher,
		useCallback(
			(captureEvent: CaptureEventParams | undefined) => {
				if (captureEvent?.event === CaptureEvent.onCaptureFinish) {
					resetCurrentIndex();
				}
			},
			[resetCurrentIndex],
		),
	);

	useStateSubscriber(
		DrawStatePublisher,
		useCallback(
			(drawState: DrawState) => {
				setEnableKeyEvent(drawState === DrawState.Idle);
			},
			[setEnableKeyEvent],
		),
	);

	useAppSettingsLoad(
		useCallback(
			(appSettings) => {
				init(appSettings);
			},
			[init],
		),
		true,
	);

	const { message } = useContext(AntdContext);

	const [, setDrawEvent] = useStateSubscriber(DrawEventPublisher, undefined);

	const currentCaptureExcalidrawElementsRef =
		useRef<readonly Ordered<NonDeletedExcalidrawElement>[]>(undefined);
	const changeCurrentIndex = useCallback(
		async (delta: number | string) => {
			const screenshotType = getScreenshotType()?.type;
			if (screenshotType === ScreenshotType.TopWindow) {
				return;
			}

			if (captureHistoryListRef.current.length === 0) {
				return;
			}

			if (isImageLoadingRef.current) {
				return;
			}

			let newIndex = currentIndexRef.current;
			if (typeof delta === "number") {
				newIndex = Math.max(
					0,
					Math.min(
						currentIndexRef.current + delta,
						screenshotType === ScreenshotType.SwitchCaptureHistory
							? Math.max(0, captureHistoryListRef.current.length - 1) // 切换截图历史时，不允许切换回截图
							: captureHistoryListRef.current.length,
					),
				);
			} else {
				newIndex = captureHistoryListRef.current.findIndex(
					(item) => item.id === delta,
				);
			}

			if (newIndex === currentIndexRef.current) {
				return;
			}

			currentIndexRef.current = newIndex;

			isImageLoadingRef.current = true;

			const hideLoading = message.loading({
				content: <FormattedMessage id="draw.loadingCaptureHistory" />,
			});

			setDrawEvent({
				event: DrawEvent.ClearContext,
				params: undefined,
			});
			if (currentIndexRef.current === captureHistoryListRef.current.length) {
				const switchCaptureHistoryPromise = Promise.all([
					imageLayerActionRef.current
						?.switchCaptureHistory(undefined)
						.then(() => {
							// 恢复绘制的内容
							if (currentCaptureExcalidrawElementsRef.current) {
								drawLayerActionRef.current?.updateScene({
									elements: currentCaptureExcalidrawElementsRef.current ?? [],
									captureUpdate: "NEVER",
								});
								drawLayerActionRef.current?.clearHistory();
								currentCaptureExcalidrawElementsRef.current = undefined;
							}
						}),
					colorPickerActionRef.current?.switchCaptureHistory(undefined),
				]);

				selectLayerActionRef.current?.switchCaptureHistory(undefined);

				await switchCaptureHistoryPromise;
			} else {
				const switchCaptureHistoryPromise = Promise.all([
					imageLayerActionRef.current
						?.switchCaptureHistory(
							captureHistoryListRef.current[currentIndexRef.current],
						)
						.then(() => {
							// 等待切换完成后，再更新绘制内容
							// 避免模糊工具更新时取得错误数据

							// 保存当前绘制的内容
							if (currentCaptureExcalidrawElementsRef.current === undefined) {
								currentCaptureExcalidrawElementsRef.current =
									drawLayerActionRef.current
										?.getExcalidrawAPI()
										?.getSceneElements();
							}

							drawLayerActionRef.current?.updateScene({
								elements:
									captureHistoryListRef.current[currentIndexRef.current]
										.excalidraw_elements ?? [],
								appState:
									captureHistoryListRef.current[currentIndexRef.current]
										.excalidraw_app_state,
								captureUpdate: "NEVER",
							});
						}),
					colorPickerActionRef.current?.switchCaptureHistory(
						captureHistoryListRef.current[currentIndexRef.current],
					),
				]);

				selectLayerActionRef.current?.switchCaptureHistory(
					captureHistoryListRef.current[currentIndexRef.current],
				);

				drawLayerActionRef.current?.clearHistory();

				await switchCaptureHistoryPromise;
			}

			isImageLoadingRef.current = false;

			hideLoading();
		},
		[
			colorPickerActionRef,
			drawLayerActionRef,
			imageLayerActionRef,
			getScreenshotType,
			message,
			selectLayerActionRef,
			setDrawEvent,
		],
	);

	const saveCurrentCapture = useCallback(
		async (
			imageBuffer:
				| ImageBuffer
				| ImageSharedBufferData
				| CaptureFullScreenResult
				| CaptureHistoryItem,
			selectRect: ElementRect | undefined,
			excalidrawElements:
				| readonly Ordered<NonDeletedExcalidrawElement>[]
				| undefined,
			appState: Readonly<AppState> | undefined,
			captureResult?: ArrayBuffer,
			source?: CaptureHistorySource,
		) => {
			let sharedBufferEncodeImagePromise: Promise<ArrayBuffer | undefined> =
				Promise.resolve(undefined);
			if (
				imageBuffer &&
				"sharedBuffer" in imageBuffer &&
				!captureHistoryListRef.current[currentIndexRef.current]
			) {
				sharedBufferEncodeImagePromise = encodeImage(
					imageBuffer.width,
					imageBuffer.height,
					imageBuffer.sharedBuffer,
				);
			}

			if (!captureHistoryRef.current) {
				appError(
					"[CaptureHistoryController] saveCurrentCapture error, invalid state",
					{
						captureHistoryRef: captureHistoryRef.current,
					},
				);
				return;
			}

			if (!selectRect) {
				appError(
					"[CaptureHistoryController] saveCurrentCapture error, invalid selectRect",
					{
						selectRect: selectRect,
					},
				);
				return;
			}

			const sharedBufferEncodeImage = await sharedBufferEncodeImagePromise;

			const captureHistoryItem = await captureHistoryRef.current.save(
				captureHistoryListRef.current[currentIndexRef.current] ??
					(sharedBufferEncodeImage
						? {
								encodeData: sharedBufferEncodeImage,
							}
						: imageBuffer),
				excalidrawElements,
				appState,
				selectRect,
				captureResult,
				source,
			);
			captureHistoryListRef.current.push(captureHistoryItem);
			resetCurrentIndex();
			onCaptureHistoryChange();
		},
		[resetCurrentIndex],
	);

	const captureFullScreenAction = useCallback(async () => {
		if (!captureHistoryRef.current) {
			appError(
				"[CaptureHistoryController] captureFullScreenAction error, invalid state",
				{
					captureHistoryRef: captureHistoryRef.current,
				},
			);
			return;
		}

		const appSettings = getAppSettings();
		const captureHistoryParams = CaptureHistory.generateCaptureHistoryItem(
			"full-screen",
			undefined,
			undefined,
			undefined,
			undefined,
			CaptureHistorySource.FullScreen,
		);

		const imagePath = await getImagePathFromSettings(
			appSettings,
			"full-screen",
		);
		if (!imagePath) {
			return;
		}

		let captureFullScreenResult: CaptureFullScreenResult;
		try {
			const captureFullScreenResultPromise = captureFullScreen(
				appSettings[AppSettingsGroup.SystemScreenshot].enableMultipleMonitor,
				imagePath.filePath,
				appSettings[AppSettingsGroup.FunctionScreenshot]
					.fullScreenCopyToClipboard,
				await getCaptureHistoryImageAbsPath(captureHistoryParams.file_name),
				getCorrectHdrColorAlgorithm(appSettings),
				appSettings[AppSettingsGroup.SystemScreenshot].correctColorFilter,
			);
			playCameraShutterSound();
			captureFullScreenResult = await captureFullScreenResultPromise;
		} catch (error) {
			appError(
				"[CaptureHistoryController] captureFullScreenAction error",
				error,
			);
			return;
		}

		captureHistoryParams.selected_rect = captureFullScreenResult.monitor_rect;
		const captureHistoryItemPromise = captureHistoryRef.current.save(
			{
				type: "full-screen",
				captureHistoryItem: captureHistoryParams,
			},
			undefined,
			undefined,
			captureFullScreenResult.monitor_rect,
			undefined,
			CaptureHistorySource.FullScreen,
		);
		const captureHistoryItem = await captureHistoryItemPromise;
		captureHistoryListRef.current.push(captureHistoryItem);
		resetCurrentIndex();
		onCaptureHistoryChange();
	}, [getAppSettings, resetCurrentIndex]);

	useImperativeHandle(actionRef, () => {
		return {
			saveCurrentCapture,
			switch: changeCurrentIndex,
			captureFullScreen: captureFullScreenAction,
			getCurrentIndex: () => currentIndexRef.current,
			getCurrentCaptureHistoryItem: () =>
				captureHistoryListRef.current[currentIndexRef.current],
		};
	}, [saveCurrentCapture, changeCurrentIndex, captureFullScreenAction]);

	return (
		<>
			<KeyEventWrap
				componentKey={DrawToolbarKeyEventKey.PreviousCapture}
				onKeyDown={() => {
					changeCurrentIndex(-1);
				}}
			>
				<div />
			</KeyEventWrap>
			<KeyEventWrap
				componentKey={DrawToolbarKeyEventKey.NextCapture}
				onKeyDown={() => {
					changeCurrentIndex(1);
				}}
			>
				<div />
			</KeyEventWrap>
		</>
	);
};

export const CaptureHistoryController = React.memo(
	withStatePublisher(CaptureHistoryControllerCore, EnableKeyEventPublisher),
);
