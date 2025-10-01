'use client';

import { AppSettingsData, AppSettingsGroup } from '@/app/contextWrap';
import { initUiElements } from '@/commands';
import { autoStartDisable, autoStartEnable } from '@/commands/core';
import { ocrInit } from '@/commands/ocr';
import { videoRecordInit } from '@/commands/videoRecord';
import { useAppSettingsLoad } from '@/hooks/useAppSettingsLoad';
import { CaptureHistory } from '@/utils/captureHistory';
import { useCallback, useEffect, useRef } from 'react';

export const InitService = () => {
    // 清除无效的截图历史
    const clearCaptureHistory = useCallback(async (appSettings: AppSettingsData) => {
        const captureHistory = new CaptureHistory();
        await captureHistory.init();
        await captureHistory.clearExpired(appSettings);
    }, []);

    const hasClearedCaptureHistory = useRef(false);
    const hasInitAutoStart = useRef(false);
    useAppSettingsLoad(
        useCallback(
            (appSettings, prevAppSettings) => {
                ocrInit(appSettings[AppSettingsGroup.SystemScreenshot].ocrModel);

                if (!hasClearedCaptureHistory.current) {
                    hasClearedCaptureHistory.current = true;

                    clearCaptureHistory(appSettings);
                }

                if (
                    process.env.NODE_ENV !== 'development' &&
                    (!hasInitAutoStart.current ||
                        appSettings[AppSettingsGroup.SystemCommon].autoStart !==
                            prevAppSettings?.[AppSettingsGroup.SystemCommon].autoStart)
                ) {
                    hasInitAutoStart.current = true;

                    if (appSettings[AppSettingsGroup.SystemCommon].autoStart) {
                        autoStartEnable();
                    } else {
                        autoStartDisable();
                    }
                }
            },
            [clearCaptureHistory],
        ),
        true,
    );

    const inited = useRef(false);

    useEffect(() => {
        if (inited.current) {
            return;
        }
        inited.current = true;

        initUiElements();
        videoRecordInit();
    }, []);

    return null;
};
