import { Button, Flex, theme } from 'antd';
import { useIntl } from 'react-intl';
import { useState, useCallback, useContext, useMemo } from 'react';
import { DrawStatePublisher } from '@/app/fullScreenDraw/components/drawCore/extra';
import { useStateSubscriber } from '@/hooks/useStateSubscriber';
import { DrawState } from '@/types/draw';
import { getButtonTypeByState } from '../../../extra';
import { DiamondIcon, RectIcon } from '@/components/icons';
import { AppSettingsData, AppSettingsGroup } from '@/types/appSettings';
import { ToolbarPopover } from '@/app/draw/components/drawToolbar/components/toolbarPopover';
import { ToolButton } from '../../toolButton';
import { DrawToolbarKeyEventKey } from '@/types/components/drawToolbar';
import React from 'react';
import {
    AppSettingsActionContext,
    AppSettingsPublisher,
} from '@/contexts/appSettingsActionContext';

const RectToolCore: React.FC<{
    customToolbarToolHiddenMap: Partial<Record<DrawState, boolean>> | undefined;
    onToolClickAction: (tool: DrawState) => void;
    disable: boolean;
}> = ({ customToolbarToolHiddenMap, onToolClickAction, disable }) => {
    const intl = useIntl();
    const { token } = theme.useToken();

    const { updateAppSettings } = useContext(AppSettingsActionContext);

    const [lastRectTool, setLastRectTool] = useState<DrawState>(DrawState.Rect);
    useStateSubscriber(
        AppSettingsPublisher,
        useCallback(
            (settings: AppSettingsData) => {
                setLastRectTool(settings[AppSettingsGroup.Cache].lastRectTool);
            },
            [setLastRectTool],
        ),
    );
    const [drawState, setDrawState] = useState(DrawState.Idle);
    useStateSubscriber(
        DrawStatePublisher,
        useCallback(
            (state: DrawState) => {
                setDrawState(state);
            },
            [setDrawState],
        ),
    );

    const updateLastRectTool = useCallback(
        (value: DrawState) => {
            updateAppSettings(
                AppSettingsGroup.Cache,
                { lastRectTool: value },
                true,
                true,
                false,
                true,
                false,
            );
        },
        [updateAppSettings],
    );

    const rectButton = useMemo(() => {
        return (
            <ToolButton
                componentKey={DrawToolbarKeyEventKey.RectTool}
                hidden={customToolbarToolHiddenMap?.[DrawState.Rect]}
                icon={<RectIcon style={{ fontSize: '1em' }} />}
                disable={disable}
                drawState={DrawState.Rect}
                key="rect"
                onClick={() => {
                    onToolClickAction(DrawState.Rect);
                    updateLastRectTool(DrawState.Rect);
                }}
            />
        );
    }, [disable, customToolbarToolHiddenMap, onToolClickAction, updateLastRectTool]);

    const diamondButton = useMemo(() => {
        return (
            <Button
                icon={<DiamondIcon />}
                title={intl.formatMessage({ id: 'draw.diamondTool' })}
                type={getButtonTypeByState(drawState === DrawState.Diamond)}
                key="diamond"
                onClick={() => {
                    onToolClickAction(DrawState.Diamond);
                    updateLastRectTool(DrawState.Diamond);
                }}
                disabled={disable}
            />
        );
    }, [disable, drawState, intl, onToolClickAction, updateLastRectTool]);

    let mainToolbarButton = customToolbarToolHiddenMap?.[DrawState.Rect]
        ? diamondButton
        : rectButton;
    if (lastRectTool === DrawState.Rect && !customToolbarToolHiddenMap?.[DrawState.Rect]) {
        mainToolbarButton = rectButton;
    } else if (
        lastRectTool === DrawState.Diamond &&
        !customToolbarToolHiddenMap?.[DrawState.Diamond]
    ) {
        mainToolbarButton = diamondButton;
    }

    if (
        customToolbarToolHiddenMap?.[DrawState.Rect] &&
        customToolbarToolHiddenMap?.[DrawState.Diamond]
    ) {
        mainToolbarButton = <></>;
    }

    return (
        <>
            <ToolbarPopover
                trigger={
                    !customToolbarToolHiddenMap?.[DrawState.Rect] &&
                    !customToolbarToolHiddenMap?.[DrawState.Diamond]
                        ? 'hover'
                        : []
                }
                content={
                    <Flex align="center" gap={token.paddingXS} className="popover-toolbar">
                        {rectButton}
                        {!customToolbarToolHiddenMap?.[DrawState.Diamond] && diamondButton}
                    </Flex>
                }
            >
                <div>{mainToolbarButton}</div>
            </ToolbarPopover>
        </>
    );
};

export const RectTool = React.memo(RectToolCore);
