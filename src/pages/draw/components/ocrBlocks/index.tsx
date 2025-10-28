import {
	useCallback,
	useContext,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { DrawStatePublisher } from "@/components/drawCore/extra";
import { INIT_CONTAINER_KEY } from "@/components/imageLayer/actions";
import { PLUGIN_ID_TRANSLATE } from "@/constants/pluginService";
import { AppSettingsPublisher } from "@/contexts/appSettingsActionContext";
import { usePluginServiceContext } from "@/contexts/pluginServiceContext";
import { useStateSubscriber } from "@/hooks/useStateSubscriber";
import {
	type AppOcrResult,
	covertOcrResultToText,
	OcrResult,
	type OcrResultActionType,
	type OcrResultType,
} from "@/pages/fixedContent/components/ocrResult";
import {
	AppSettingsGroup,
	type ChatApiConfig,
	OcrDetectAfterAction,
} from "@/types/appSettings";
import type { OcrDetectResult } from "@/types/commands/ocr";
import type { ElementRect } from "@/types/commands/screenshot";
import { DrawState } from "@/types/draw";
import { writeTextToClipboard } from "@/utils/clipboard";
import { ScreenshotType } from "@/utils/types";
import { zIndexs } from "@/utils/zIndex";
import { getCanvas } from "../../actions";
import {
	type CaptureBoundingBoxInfo,
	ScreenshotTypePublisher,
} from "../../extra";
import { DrawContext } from "../../types";
import OcrTool, { isOcrTool } from "../drawToolbar/components/tools/ocrTool";

export type OcrBlocksSelectedText = {
	type: "text" | "visionModelHtml";
	text: string;
};

export type OcrBlocksActionType = {
	init: (
		selectRect: ElementRect,
		captureBoundingBoxInfo: CaptureBoundingBoxInfo,
		canvas: HTMLCanvasElement,
		ocrResult: AppOcrResult | undefined,
	) => Promise<void>;
	setEnable: (enable: boolean | ((enable: boolean) => boolean)) => void;
	getOcrResultAction: () => OcrResultActionType | undefined;
	getSelectedText: () => OcrBlocksSelectedText | undefined;
};

export const OcrBlocks: React.FC<{
	actionRef: React.RefObject<OcrBlocksActionType | undefined>;
	finishCapture: () => void;
}> = ({ actionRef, finishCapture }) => {
	const { selectLayerActionRef, imageLayerActionRef, drawLayerActionRef } =
		useContext(DrawContext);
	const ocrResultActionRef = useRef<OcrResultActionType>(undefined);

	const [getScreenshotType] = useStateSubscriber(
		ScreenshotTypePublisher,
		undefined,
	);
	const [getAppSettings] = useStateSubscriber(AppSettingsPublisher, undefined);
	const [getDrawState] = useStateSubscriber(
		DrawStatePublisher,
		useCallback((drawState: DrawState) => {
			ocrResultActionRef.current?.setEnable(isOcrTool(drawState));
			ocrResultActionRef.current?.clear();
		}, []),
	);

	useImperativeHandle(
		actionRef,
		() => ({
			init: async (
				selectRect: ElementRect,
				captureBoundingBoxInfo: CaptureBoundingBoxInfo,
				canvas: HTMLCanvasElement,
				ocrResult: AppOcrResult | undefined,
			) => {
				ocrResultActionRef.current?.init({
					selectRect,
					captureBoundingBoxInfo,
					canvas,
					ocrResult,
				});
			},
			setEnable: (enable: boolean | ((enable: boolean) => boolean)) => {
				ocrResultActionRef.current?.setEnable(enable);
			},
			getOcrResultAction: () => {
				return ocrResultActionRef.current;
			},
			getSelectedText: () => {
				return ocrResultActionRef.current?.getSelectedText();
			},
		}),
		[],
	);

	const onOcrDetect = useCallback(
		(ocrResult: OcrDetectResult) => {
			// 判断是否是 OCR 工具
			if (!isOcrTool(getDrawState())) {
				return;
			}

			// 只在 OCR 检测时启用 OCR 后操作,截图翻译时不启用
			if (getDrawState() === DrawState.OcrDetect) {
				const ocrAfterAction =
					getAppSettings()[AppSettingsGroup.FunctionScreenshot].ocrAfterAction;

				if (
					ocrAfterAction === OcrDetectAfterAction.CopyText ||
					(ocrAfterAction === OcrDetectAfterAction.OcrDetectCopyText &&
						getScreenshotType().type === ScreenshotType.OcrDetect)
				) {
					writeTextToClipboard(covertOcrResultToText(ocrResult));
				} else if (
					ocrAfterAction === OcrDetectAfterAction.CopyTextAndCloseWindow ||
					(ocrAfterAction ===
						OcrDetectAfterAction.OcrDetectCopyTextAndCloseWindow &&
						getScreenshotType().type === ScreenshotType.OcrDetect)
				) {
					writeTextToClipboard(covertOcrResultToText(ocrResult));
					finishCapture?.();
				}
			} else if (getDrawState() === DrawState.OcrTranslate) {
				ocrResultActionRef.current?.startTranslate();
			}
		},
		[finishCapture, getAppSettings, getDrawState, getScreenshotType],
	);

	const onTranslate = useCallback(() => {
		ocrResultActionRef.current?.startTranslate();
	}, []);

	const [visionModelHtmlLoading, setVisionModelHtmlLoading] = useState(false);
	const onConvertImageToHtml = useCallback(async () => {
		const selectRectParams =
			selectLayerActionRef.current?.getSelectRectParams();
		const imageLayerAction = imageLayerActionRef.current;
		const drawLayerAction = drawLayerActionRef.current;
		if (!selectRectParams || !imageLayerAction || !drawLayerAction) {
			return;
		}

		setVisionModelHtmlLoading(true);
		const screenshotCanvas = await getCanvas(
			selectRectParams,
			imageLayerAction,
			drawLayerAction,
			true,
			true,
			INIT_CONTAINER_KEY,
		);

		if (!screenshotCanvas) {
			return;
		}

		await ocrResultActionRef.current?.convertImageToHtml(screenshotCanvas);
		setVisionModelHtmlLoading(false);
	}, [selectLayerActionRef, imageLayerActionRef, drawLayerActionRef]);

	const [currentOcrResult, setCurrentOcrResult] = useState<
		(AppOcrResult & { ocrResultType: OcrResultType }) | undefined
	>(undefined);
	const [ocrResult, setOcrResult] = useState<AppOcrResult | undefined>(
		undefined,
	);
	const [translatedOcrResult, setTranslatedOcrResult] = useState<
		AppOcrResult | undefined
	>(undefined);
	const [translateLoading, setTranslateLoading] = useState(false);
	const onSwitchOcrResult = useCallback((ocrResultType: OcrResultType) => {
		ocrResultActionRef.current?.switchOcrResult(ocrResultType);
	}, []);
	const [visionModelHtmlResult, setVisionModelHtmlResult] = useState<
		AppOcrResult | undefined
	>(undefined);
	const [visionModelList, setVisionModelList] = useState<ChatApiConfig[]>([]);

	const { isReadyStatus } = usePluginServiceContext();

	return (
		<>
			{isReadyStatus?.(PLUGIN_ID_TRANSLATE) && (
				<OcrTool
					onSwitchOcrResult={onSwitchOcrResult}
					onTranslate={onTranslate}
					onConvertImageToHtml={onConvertImageToHtml}
					currentOcrResult={currentOcrResult}
					ocrResult={ocrResult}
					translatedOcrResult={translatedOcrResult}
					translateLoading={translateLoading}
					visionModelHtmlResult={visionModelHtmlResult}
					visionModelHtmlLoading={visionModelHtmlLoading}
					visionModelList={visionModelList}
				/>
			)}

			<OcrResult
				zIndex={zIndexs.Draw_OcrResult}
				actionRef={ocrResultActionRef}
				onOcrDetect={onOcrDetect}
				onCurrentOcrResultChange={setCurrentOcrResult}
				onOcrResultChange={setOcrResult}
				onTranslatedResultChange={setTranslatedOcrResult}
				onTranslateLoading={setTranslateLoading}
				onVisionModelHtmlResultChange={setVisionModelHtmlResult}
				onVisionModelListChange={setVisionModelList}
			/>
		</>
	);
};
