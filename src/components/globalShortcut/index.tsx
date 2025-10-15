'use client';

import React, { createContext, useCallback, useMemo, useRef, useState } from 'react';
import { FormattedMessage } from 'react-intl';
import {
    ChatIcon,
    ClipboardIcon,
    FixedIcon,
    FocusedWindowIcon,
    FullScreenDrawIcon,
    FullScreenIcon,
    OcrDetectIcon,
    OcrTranslateIcon,
    ScreenshotIcon,
    SelectTextIcon,
    TopWindowIcon,
    TranslationIcon,
    VideoRecordIcon,
} from '@/components/icons';
import {
    executeFixedClipboardContent,
    executeScreenshot,
    executeScreenshotFocusedWindow,
} from '@/functions/screenshot';
import { ScreenshotType } from '@/utils/types';
import {
    isRegistered,
    register,
    unregister,
    unregisterAll,
} from '@tauri-apps/plugin-global-shortcut';
import { useAppSettingsLoad } from '@/hooks/useAppSettingsLoad';
import { useStateSubscriber } from '@/hooks/useStateSubscriber';
import {
    executeChat,
    executeChatSelectedText,
    executeTranslate,
    executeTranslateSelectedText,
} from '@/functions/tools';
import { createFullScreenDrawWindow } from '@/commands/core';
import { IconLabel } from '@/components/iconLable';
import { AppSettingsData, AppSettingsGroup, AppSettingsPublisher } from '@/app/contextWrap';
import { TrayIconStatePublisher } from '@/app/trayIcon';
import {
    AppFunction,
    AppFunctionComponentConfig,
    AppFunctionConfig,
    AppFunctionGroup,
    defaultAppFunctionConfigs,
    ShortcutKeyStatus,
} from '@/app/extra';
import { FieldTimeOutlined } from '@ant-design/icons';
import { ChangeDelaySeconds } from './components/changeDelaySeconds';
import { Tooltip } from 'antd';
import { startOrCopyVideo } from '@/functions/videoRecord';
import {
    PLUGIN_ID_AI_CHAT,
    PLUGIN_ID_FFMPEG,
    PLUGIN_ID_RAPID_OCR,
    usePluginService,
} from '../pluginService';
import { useDeepCompareEffect } from '@ant-design/pro-components';

export type GlobalShortcutContextType = {
    disableShortcutKeyRef: React.RefObject<boolean>;
    defaultAppFunctionComponentGroupConfigs: Record<AppFunctionGroup, AppFunctionComponentConfig[]>;
    shortcutKeyStatus: Record<AppFunction, ShortcutKeyStatus> | undefined;
    updateShortcutKeyStatusLoading: boolean;
    appSettingsLoading: boolean;
    appFunctionSettings: AppSettingsData[AppSettingsGroup.AppFunction] | undefined;
};

export const GlobalShortcutContext = createContext<GlobalShortcutContextType>({
    disableShortcutKeyRef: { current: false },
    defaultAppFunctionComponentGroupConfigs: {} as Record<
        AppFunctionGroup,
        AppFunctionComponentConfig[]
    >,
    shortcutKeyStatus: {} as Record<AppFunction, ShortcutKeyStatus>,
    updateShortcutKeyStatusLoading: true,
    appSettingsLoading: true,
    appFunctionSettings: {} as AppSettingsData[AppSettingsGroup.AppFunction],
});

const GlobalShortcutCore = ({ children }: { children: React.ReactNode }) => {
    const disableShortcutKeyRef = useRef(false);
    const [getTrayIconState] = useStateSubscriber(TrayIconStatePublisher, undefined);

    const [getAppSettings] = useStateSubscriber(
        AppSettingsPublisher,
        // useCallback((settings: AppSettingsData) => {}, []),
        undefined,
    );

    const { isReadyStatus } = usePluginService();
    const {
        configs: defaultAppFunctionComponentConfigs,
        groupConfigs: defaultAppFunctionComponentGroupConfigs,
    }: {
        configs: Record<AppFunction, AppFunctionComponentConfig>;
        groupConfigs: Record<AppFunctionGroup, AppFunctionComponentConfig[]>;
    } = useMemo(() => {
        const configs = Object.keys(defaultAppFunctionConfigs)
            .filter((key) => {
                if (key === AppFunction.VideoRecord || key === AppFunction.VideoRecordCopy) {
                    return isReadyStatus?.(PLUGIN_ID_FFMPEG);
                }

                if (
                    key === AppFunction.ScreenshotOcr ||
                    key === AppFunction.ScreenshotOcrTranslate
                ) {
                    return isReadyStatus?.(PLUGIN_ID_RAPID_OCR);
                }

                if (key === AppFunction.Chat) {
                    return isReadyStatus?.(PLUGIN_ID_AI_CHAT);
                }

                return true;
            })
            .reduce(
                (configs, key) => {
                    let buttonTitle;
                    let buttonIcon;
                    let buttonOnClick: () => void | Promise<void>;
                    switch (key) {
                        case AppFunction.ScreenshotFixed:
                            buttonTitle = <FormattedMessage id="draw.fixedTool" />;
                            buttonIcon = <FixedIcon style={{ fontSize: '1.3em' }} />;
                            buttonOnClick = () => executeScreenshot(ScreenshotType.Fixed);
                            break;
                        case AppFunction.ScreenshotDelay:
                            buttonTitle = (
                                <Tooltip
                                    title={
                                        <FormattedMessage id="home.screenshotFunction.screenshotDelay.tip" />
                                    }
                                    key="screenshot-delay"
                                >
                                    <div>
                                        <FormattedMessage
                                            id="home.screenshotFunction.screenshotDelay"
                                            values={{
                                                seconds: (
                                                    <ChangeDelaySeconds key="screenshot-delay-seconds" />
                                                ),
                                            }}
                                        />
                                    </div>
                                </Tooltip>
                            );
                            buttonIcon = <FieldTimeOutlined />;
                            buttonOnClick = () => executeScreenshot(ScreenshotType.Delay);
                            break;
                        case AppFunction.ScreenshotOcr:
                            buttonTitle = <FormattedMessage id="draw.ocrDetectTool" />;
                            buttonIcon = <OcrDetectIcon />;
                            buttonOnClick = () => executeScreenshot(ScreenshotType.OcrDetect);
                            break;
                        case AppFunction.ScreenshotOcrTranslate:
                            buttonTitle = <FormattedMessage id="draw.ocrTranslateTool" />;
                            buttonIcon = <OcrTranslateIcon style={{ fontSize: '1.2em' }} />;
                            buttonOnClick = () => executeScreenshot(ScreenshotType.OcrTranslate);
                            break;
                        case AppFunction.ScreenshotFullScreen:
                            buttonTitle = (
                                <FormattedMessage id="home.screenshotFunction.screenshotFullScreen" />
                            );
                            buttonIcon = <FullScreenIcon />;
                            buttonOnClick = () =>
                                executeScreenshot(ScreenshotType.CaptureFullScreen);
                            break;
                        case AppFunction.ScreenshotFocusedWindow:
                            buttonTitle = (
                                <IconLabel
                                    label={
                                        <FormattedMessage id="home.screenshotFunction.screenshotFocusedWindow" />
                                    }
                                />
                            );
                            buttonIcon = <FocusedWindowIcon />;
                            buttonOnClick = async () => {
                                executeScreenshotFocusedWindow(getAppSettings());
                            };
                            break;
                        case AppFunction.ScreenshotCopy:
                            buttonTitle = (
                                <FormattedMessage id="home.screenshotFunction.screenshotCopy" />
                            );
                            buttonIcon = <ClipboardIcon style={{ fontSize: '1.1em' }} />;
                            buttonOnClick = () => executeScreenshot(ScreenshotType.Copy);
                            break;
                        case AppFunction.TranslationSelectText:
                            buttonTitle = <FormattedMessage id="home.translationSelectText" />;
                            buttonIcon = <SelectTextIcon style={{ fontSize: '1em' }} />;
                            buttonOnClick = async () => {
                                executeTranslateSelectedText();
                            };
                            break;
                        case AppFunction.Translation:
                            buttonTitle = <FormattedMessage id="home.translation" />;
                            buttonIcon = <TranslationIcon />;
                            buttonOnClick = () => {
                                executeTranslate();
                            };
                            break;
                        case AppFunction.ChatSelectText:
                            buttonTitle = <FormattedMessage id="home.chatSelectText" />;
                            buttonIcon = <SelectTextIcon style={{ fontSize: '1em' }} />;
                            buttonOnClick = async () => {
                                executeChatSelectedText();
                            };
                            break;
                        case AppFunction.Chat:
                            buttonTitle = <FormattedMessage id="home.chat" />;
                            buttonIcon = <ChatIcon />;
                            buttonOnClick = () => {
                                executeChat();
                            };
                            break;
                        case AppFunction.TopWindow:
                            buttonTitle = <FormattedMessage id="home.topWindow" />;
                            buttonIcon = <TopWindowIcon />;
                            buttonOnClick = () => executeScreenshot(ScreenshotType.TopWindow);
                            break;
                        case AppFunction.FixedContent:
                            buttonTitle = <FormattedMessage id="home.fixedContent" />;
                            buttonIcon = <ClipboardIcon style={{ fontSize: '1.1em' }} />;
                            buttonOnClick = () => {
                                executeFixedClipboardContent();
                            };
                            break;
                        case AppFunction.FullScreenDraw:
                            buttonTitle = <FormattedMessage id="home.fullScreenDraw" />;
                            buttonIcon = <FullScreenDrawIcon style={{ fontSize: '1.2em' }} />;
                            buttonOnClick = () => createFullScreenDrawWindow();
                            break;
                        case AppFunction.VideoRecord:
                            buttonTitle = (
                                <FormattedMessage id="home.videoRecordFunction.videoRecord" />
                            );
                            buttonIcon = <VideoRecordIcon style={{ fontSize: '1.1em' }} />;
                            buttonOnClick = () => executeScreenshot(ScreenshotType.VideoRecord);
                            break;
                        case AppFunction.VideoRecordCopy:
                            buttonTitle = (
                                <FormattedMessage id="home.videoRecordFunction.copyVideo" />
                            );
                            buttonIcon = <ClipboardIcon style={{ fontSize: '1.1em' }} />;
                            buttonOnClick = () => {
                                startOrCopyVideo();
                            };
                            break;
                        case AppFunction.Screenshot:
                        default:
                            buttonTitle = <FormattedMessage id="home.screenshot" />;
                            buttonIcon = <ScreenshotIcon />;
                            buttonOnClick = () => executeScreenshot();
                            break;
                    }

                    const onClick = async () => {
                        if (disableShortcutKeyRef.current) {
                            return;
                        }

                        await buttonOnClick();
                    };
                    configs[key as AppFunction] = {
                        ...defaultAppFunctionConfigs[key as AppFunction],
                        configKey: key as AppFunction,
                        title: buttonTitle,
                        icon: buttonIcon,
                        onClick,
                        onKeyChange: async (value: string, prevValue: string) => {
                            if (prevValue) {
                                if (await isRegistered(prevValue)) {
                                    await unregister(prevValue);
                                }
                            }

                            if (!value) {
                                return false;
                            }

                            if (await isRegistered(value)) {
                                return false;
                            }

                            try {
                                await register(value, (event) => {
                                    if (event.state !== 'Released') {
                                        return;
                                    }

                                    if (getTrayIconState()?.disableShortcut) {
                                        return;
                                    }

                                    onClick();
                                });
                            } catch (error) {
                                // 将错误传给组件，组件捕获错误来判断快捷键状态
                                throw error;
                            }

                            return true;
                        },
                    };

                    return configs;
                },
                {} as Record<AppFunction, AppFunctionComponentConfig>,
            );

        const groupConfigs = Object.values(configs).reduce(
            (groupConfigs, config) => {
                if (!groupConfigs[config.group]) {
                    groupConfigs[config.group] = [];
                }

                groupConfigs[config.group].push(config);
                return groupConfigs;
            },
            {} as Record<AppFunctionGroup, AppFunctionComponentConfig[]>,
        );

        return { configs, groupConfigs };
    }, [getAppSettings, getTrayIconState, isReadyStatus]);

    const [shortcutKeyStatus, setShortcutKeyStatus] =
        useState<Record<AppFunction, ShortcutKeyStatus>>();

    const [updateShortcutKeyStatusLoading, setUpdateShortcutKeyStatusLoading] = useState(true);
    const previousAppFunctionSettingsRef =
        useRef<AppSettingsData[AppSettingsGroup.AppFunction]>(undefined);

    const appFunctionComponentConfigsKeys = useMemo(
        () => Object.keys(defaultAppFunctionComponentConfigs),
        [defaultAppFunctionComponentConfigs],
    );

    const updateShortcutKeyStatus = useCallback(
        async (settings: Record<AppFunction, AppFunctionConfig>) => {
            setUpdateShortcutKeyStatusLoading(true);
            const keyStatus: Record<AppFunction, ShortcutKeyStatus> = {} as Record<
                AppFunction,
                ShortcutKeyStatus
            >;

            await Promise.all(
                appFunctionComponentConfigsKeys.map(async (key) => {
                    const config = defaultAppFunctionComponentConfigs[key as AppFunction];
                    const currentShortcutKey = settings[key as AppFunction].shortcutKey;

                    try {
                        const isSuccess = await config.onKeyChange(
                            currentShortcutKey,
                            (previousAppFunctionSettingsRef.current ?? settings)[key as AppFunction]
                                .shortcutKey,
                        );

                        if (!currentShortcutKey) {
                            keyStatus[key as AppFunction] = ShortcutKeyStatus.None;
                        } else {
                            keyStatus[key as AppFunction] = isSuccess
                                ? ShortcutKeyStatus.Registered
                                : ShortcutKeyStatus.Unregistered;
                        }

                        if (
                            keyStatus[key as AppFunction] === ShortcutKeyStatus.Registered &&
                            currentShortcutKey === 'PrintScreen'
                        ) {
                            keyStatus[key as AppFunction] = ShortcutKeyStatus.PrintScreen;
                        }
                    } catch {
                        keyStatus[key as AppFunction] = ShortcutKeyStatus.Error;
                    }
                }),
            );

            setShortcutKeyStatus(keyStatus);
            previousAppFunctionSettingsRef.current = settings;
            setUpdateShortcutKeyStatusLoading(false);
        },
        [appFunctionComponentConfigsKeys, defaultAppFunctionComponentConfigs],
    );

    const [appFunctionSettings, setAppFunctionSettings] =
        useState<AppSettingsData[AppSettingsGroup.AppFunction]>();

    const hasUnregisteredAll = useRef(false);
    useAppSettingsLoad(
        useCallback((settings: AppSettingsData) => {
            (hasUnregisteredAll.current ? Promise.resolve() : unregisterAll()).then(() => {
                setAppFunctionSettings(settings[AppSettingsGroup.AppFunction]);
            });
            hasUnregisteredAll.current = true;
        }, []),
        true,
    );

    const updateShortcutKeyStatusPendingRef = useRef(false);
    useDeepCompareEffect(() => {
        if (!appFunctionSettings || !isReadyStatus) {
            return;
        }

        if (updateShortcutKeyStatusPendingRef.current) {
            return;
        }

        updateShortcutKeyStatusPendingRef.current = true;
        updateShortcutKeyStatus(appFunctionSettings).then(() => {
            updateShortcutKeyStatusPendingRef.current = false;
        });
    }, [appFunctionSettings, isReadyStatus, updateShortcutKeyStatus]);

    const contextValue = useMemo((): GlobalShortcutContextType => {
        return {
            disableShortcutKeyRef,
            defaultAppFunctionComponentGroupConfigs,
            shortcutKeyStatus,
            updateShortcutKeyStatusLoading,
            appSettingsLoading: appFunctionSettings === undefined,
            appFunctionSettings,
        };
    }, [
        disableShortcutKeyRef,
        defaultAppFunctionComponentGroupConfigs,
        shortcutKeyStatus,
        updateShortcutKeyStatusLoading,
        appFunctionSettings,
    ]);

    return (
        <GlobalShortcutContext.Provider value={contextValue}>
            {children}
        </GlobalShortcutContext.Provider>
    );
};

export const GlobalShortcut = React.memo(GlobalShortcutCore);
