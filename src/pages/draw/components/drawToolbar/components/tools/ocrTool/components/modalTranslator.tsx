import { Form, Modal, Space, Switch, theme } from "antd";
import { trim } from "es-toolkit";
import React, {
	useCallback,
	useContext,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { useHotkeysContext } from "react-hotkeys-hook";
import { FormattedMessage, useIntl } from "react-intl";
import { DrawStatePublisher } from "@/components/drawCore/extra";
import { Translator, type TranslatorActionType } from "@/components/translator";
import { AntdContext } from "@/contexts/antdContext";
import {
	AppSettingsActionContext,
	AppSettingsPublisher,
} from "@/contexts/appSettingsActionContext";
import { useStateRef } from "@/hooks/useStateRef";
import { useStateSubscriber } from "@/hooks/useStateSubscriber";
import {
	type AppSettingsData,
	AppSettingsGroup,
	TranslationApiType,
} from "@/types/appSettings";
import type { OcrDetectResult } from "@/types/commands/ocr";
import { HotkeysScope } from "@/types/core/appHotKeys";

export type ModalTranslatorActionType = {
	startTranslate: () => void;
};

export const ModalTranslatorCore: React.FC<{
	getOcrResult: () => OcrDetectResult | undefined;
	actionRef: React.RefObject<ModalTranslatorActionType | undefined>;
	onReplace: (result: OcrDetectResult, ignoreScale?: boolean) => void;
}> = ({ getOcrResult, actionRef, onReplace: onReplaceCallback }) => {
	const intl = useIntl();
	const { token } = theme.useToken();
	const { message } = useContext(AntdContext);

	const translatorActionRef = useRef<TranslatorActionType>(undefined);
	const { disableScope, enableScope } = useHotkeysContext();

	const [autoReplace, setAutoReplace, autoReplaceRef] = useStateRef(false);
	const [keepLayout, setKeepLayout, keepLayoutRef] = useStateRef(false);
	const [showProcess, setShowProcess, showProcessRef] = useStateRef(false);
	useStateSubscriber(
		AppSettingsPublisher,
		useCallback(
			(appSettings: AppSettingsData) => {
				setAutoReplace(
					appSettings[AppSettingsGroup.Cache].ocrTranslateAutoReplace,
				);
				setKeepLayout(
					appSettings[AppSettingsGroup.Cache].ocrTranslateKeepLayout,
				);
				setShowProcess(
					appSettings[AppSettingsGroup.Cache].ocrTranslateShowProcess,
				);
			},
			[setAutoReplace, setKeepLayout, setShowProcess],
		),
	);
	const { updateAppSettings } = useContext(AppSettingsActionContext);

	const [open, setOpen] = useState(false);

	const requestIdRef = useRef<number>(0);
	const lastSourceContentRef = useRef<string>(undefined);

	const hideTranslateLoadingRef = useRef<() => void>(undefined);
	const startTranslate = useCallback(() => {
		const ocrResult = getOcrResult();

		if (showProcessRef.current) {
			setOpen(true);
		} else if (translateResult.current) {
			setOpen(true);

			if (hideTranslateLoadingRef.current) {
				return;
			}
		} else {
			if (hideTranslateLoadingRef.current) {
				setOpen(true);
				return;
			}

			hideTranslateLoadingRef.current = message.loading({
				content: intl.formatMessage({
					id: "draw.ocrDetect.translate.showProcess.loading",
				}),
				duration: 30,
			});
		}

		let sourceContent = "";
		if (keepLayoutRef.current) {
			// 将 Ocr 结果转为 json 格式进行翻译
			const textLines: Record<string, string> = {};
			ocrResult?.text_blocks.forEach((block, index) => {
				textLines[`line${index + 1}`] = block.text;
			});

			sourceContent = JSON.stringify(textLines, undefined, 1);
		} else {
			sourceContent =
				ocrResult?.text_blocks.map((block) => block.text).join("\n") ?? "";
		}

		if (lastSourceContentRef.current === sourceContent) {
			return;
		}
		lastSourceContentRef.current = sourceContent;

		requestIdRef.current = Date.now();
		const currentRequestId = requestIdRef.current;

		translatorActionRef.current?.setSourceContent(
			sourceContent,
			undefined,
			currentRequestId,
		);
	}, [intl, keepLayoutRef, message, getOcrResult, showProcessRef]);

	// 切换工具时重置请求 ID
	useStateSubscriber(
		DrawStatePublisher,
		useCallback(() => {
			lastSourceContentRef.current = undefined;
			requestIdRef.current = 0;
			hideTranslateLoadingRef.current?.();
			hideTranslateLoadingRef.current = undefined;
			translateResult.current = undefined;
		}, []),
	);

	useImperativeHandle(
		actionRef,
		useCallback(
			() => ({
				startTranslate,
			}),
			[startTranslate],
		),
	);
	// 保留排版自动刷新内容
	useEffect(() => {
		if (!open) {
			return;
		}

		startTranslate();
	}, [open, startTranslate]);

	const translateResult = useRef<string>(undefined);
	const replaceOcrResult = useCallback(() => {
		const ocrResult = getOcrResult();

		if (!translateResult.current || !ocrResult) {
			return;
		}

		if (!keepLayoutRef.current) {
			let boxPointMinX = 0;
			let boxPointMinY = 0;
			let boxPointMaxX = 0;
			let boxPointMaxY = 0;

			ocrResult.text_blocks.forEach((block) => {
				boxPointMinX = Math.min(boxPointMinX, block.box_points[0].x);
				boxPointMinY = Math.min(boxPointMinY, block.box_points[0].y);
				boxPointMaxX = Math.max(boxPointMaxX, block.box_points[2].x);
				boxPointMaxY = Math.max(boxPointMaxY, block.box_points[2].y);
			});

			onReplaceCallback(
				{
					text_blocks: [
						{
							box_points: [
								{ x: boxPointMinX, y: boxPointMinY },
								{ x: boxPointMaxX, y: boxPointMinY },
								{ x: boxPointMaxX, y: boxPointMaxY },
								{ x: boxPointMinX, y: boxPointMaxY },
							],
							text: translateResult.current
								.split("\n")
								.map((line) => trim(line))
								.filter((line) => line.length > 0)
								.join("\n"),
							text_score: 1,
						},
					],
					scale_factor: ocrResult.scale_factor,
				},
				true,
			);

			return;
		}

		if (
			translatorActionRef.current?.getTranslationType() ===
			TranslationApiType.DeepL
		) {
			// DeepL 支持批量翻译
			const values = translateResult.current
				.split("\n")
				.map((line) => trim(line));
			if (values.length === ocrResult.text_blocks.length) {
				const result: OcrDetectResult = {
					...ocrResult,
					text_blocks: ocrResult.text_blocks.map((block, index) => ({
						...block,
						text: values[index],
					})),
				};

				onReplaceCallback(result);
				return;
			}
		}

		try {
			const jsonResult = JSON.parse(translateResult.current);

			const keys = Object.keys(jsonResult);
			if (keys.length !== ocrResult.text_blocks.length) {
				message.warning(
					intl.formatMessage({ id: "draw.ocrDetect.translate.error2" }),
				);
				throw new Error();
			}

			const result: OcrDetectResult = {
				...ocrResult,
				text_blocks: ocrResult.text_blocks.map((block, index) => ({
					...block,
					text: keys[index] ? jsonResult[keys[index]] : block.text,
				})),
			};

			onReplaceCallback(result);
			return;
		} catch {}

		// 如果 json 解析失败，则按行解析
		const resultLines = translateResult.current
			.split("\n")
			.map((line) => trim(line));

		if (resultLines.length < ocrResult.text_blocks.length) {
			message.warning(
				intl.formatMessage({ id: "draw.ocrDetect.translate.error3" }),
			);
		}

		const result: OcrDetectResult = {
			...ocrResult,
			text_blocks: ocrResult.text_blocks.map((block, index) => {
				let text = block.text;

				const line = resultLines[index + 1];
				const linePrefixLength = 4 + index.toString().length + 5;
				const lineSuffixLength = 2;
				if (line && line.length > linePrefixLength + lineSuffixLength) {
					text = line.slice(linePrefixLength, line.length - lineSuffixLength);
				}

				return {
					...block,
					text,
				};
			}),
		};

		onReplaceCallback(result);
	}, [intl, keepLayoutRef, message, getOcrResult, onReplaceCallback]);

	useEffect(() => {
		if (open) {
			disableScope(HotkeysScope.DrawTool);
		} else {
			enableScope(HotkeysScope.DrawTool);
		}

		return () => {
			enableScope(HotkeysScope.DrawTool);
		};
	}, [open, disableScope, enableScope]);

	const onTranslateComplete = useCallback(
		(result: string, requestId?: number) => {
			if (requestId !== requestIdRef.current) {
				return;
			}

			translateResult.current = result;
			if (autoReplaceRef.current) {
				replaceOcrResult();
				setOpen(false);
				hideTranslateLoadingRef.current?.();
				hideTranslateLoadingRef.current = undefined;
			}
		},
		[autoReplaceRef, replaceOcrResult],
	);

	useEffect(() => {
		const getTranslatorAction = () => {
			return translatorActionRef.current;
		};

		return () => {
			getTranslatorAction()?.stopTranslate();
			lastSourceContentRef.current = undefined;
			hideTranslateLoadingRef.current?.();
			hideTranslateLoadingRef.current = undefined;
			translateResult.current = undefined;
		};
	}, []);

	return (
		<Modal
			width={800}
			open={open}
			onCancel={() => setOpen(false)}
			onOk={() => {
				replaceOcrResult();
				setOpen(false);
				translatorActionRef.current?.stopTranslate();
			}}
			centered
			forceRender={true}
			title={<FormattedMessage id="draw.ocrDetect.translate" />}
		>
			<div className="draw-modal-body">
				<Form style={{ margin: token.margin }}>
					<Space size={token.margin} wrap>
						<Form.Item
							label={
								<FormattedMessage id="draw.ocrDetect.translate.showProcess" />
							}
							name="result"
							layout="horizontal"
						>
							<Switch
								checked={showProcess}
								onChange={(checked) => {
									updateAppSettings(
										AppSettingsGroup.Cache,
										{ ocrTranslateKeepLayout: checked },
										true,
										true,
										false,
										true,
										true,
									);
									setShowProcess(checked);
								}}
							/>
						</Form.Item>
						<Form.Item
							label={
								<FormattedMessage id="draw.ocrDetect.translate.autoReplace" />
							}
							name="result"
							layout="horizontal"
						>
							<Switch
								checked={autoReplace}
								onChange={(checked) => {
									updateAppSettings(
										AppSettingsGroup.Cache,
										{ ocrTranslateAutoReplace: checked },
										true,
										true,
										false,
										true,
										true,
									);
									setAutoReplace(checked);
								}}
							/>
						</Form.Item>
						<Form.Item
							label={
								<FormattedMessage id="draw.ocrDetect.translate.keepLayout" />
							}
							name="result"
							layout="horizontal"
						>
							<Switch
								checked={keepLayout}
								onChange={(checked) => {
									updateAppSettings(
										AppSettingsGroup.Cache,
										{ ocrTranslateKeepLayout: checked },
										true,
										true,
										false,
										true,
										true,
									);
									setKeepLayout(checked);
								}}
							/>
						</Form.Item>
					</Space>
				</Form>

				<Translator
					disableInput
					actionRef={translatorActionRef}
					onTranslateComplete={onTranslateComplete}
					tryCatchTranslation
				/>
			</div>
		</Modal>
	);
};

export const ModalTranslator = React.memo(ModalTranslatorCore);
