import { KeyEventKey } from '@/app/draw/components/drawToolbar/components/keyEventWrap/extra';
import { ToolButton } from '@/app/draw/components/drawToolbar/components/toolButton';
import {
    ArrowIcon,
    ArrowSelectIcon,
    CircleIcon,
    DragWindowIcon,
    EraserIcon,
    PenIcon,
    RectIcon,
    SerialNumberIcon,
    TextIcon,
} from '@/components/icons';
import { Button, ButtonProps, Flex, theme } from 'antd';
import {
    DrawState,
    DrawStatePublisher,
    ExcalidrawEventPublisher,
    ExcalidrawEventParams,
    DrawCoreContext,
} from '@/app/fullScreenDraw/components/drawCore/extra';
import {
    useCallback,
    useContext,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useStateSubscriber } from '@/hooks/useStateSubscriber';
import { CheckOutlined, HolderOutlined, LockOutlined } from '@ant-design/icons';
import { AppSettingsActionContext, AppSettingsData, AppSettingsGroup } from '@/app/contextWrap';
import { useStateRef } from '@/hooks/useStateRef';
import { zIndexs } from '@/utils/zIndex';
import { useAppSettingsLoad } from '@/hooks/useAppSettingsLoad';
import { DrawToolbarActionType } from '@/app/fullScreenDraw/components/toolbar';
import { useDrawContext } from '@/app/fullScreenDraw/extra';
import { FixedContentWindowSize } from '../..';
import { HistoryControls } from '@/app/draw/components/drawToolbar/components/historyControls';
import { getButtonTypeByState } from '@/app/draw/components/drawToolbar/extra';
import { useIntl } from 'react-intl';
import { formatKey } from '@/utils/format';
import { useDragElement } from '@/app/draw/components/drawToolbar/components/dragButton';
import { startFreeDrag } from '@/commands/core';

export type FixedContentCoreDrawToolbarActionType = {
    getSize: () => { width: number; height: number };
} & DrawToolbarActionType;

export const BOX_SHADOW_WIDTH = 3;

export const FixedContentCoreDrawToolbar: React.FC<{
    actionRef: React.RefObject<FixedContentCoreDrawToolbarActionType | undefined>;
    documentSize: FixedContentWindowSize;
    disabled?: boolean;
    onConfirm: () => void;
}> = ({ actionRef, documentSize, disabled, onConfirm }) => {
    const { token } = theme.useToken();
    const intl = useIntl();

    const { updateAppSettings } = useContext(AppSettingsActionContext);
    const { getDrawCoreAction } = useDrawContext();
    const [getDrawState, setDrawState] = useStateSubscriber(DrawStatePublisher, undefined);

    const [showLockDrawTool, setShowLockDrawTool, showLockDrawToolRef] = useStateRef(false);
    const [enableLockDrawTool, setEnableLockDrawTool, enableLockDrawToolRef] = useStateRef(false);
    const [switchDrawHotKey, setSwitchDrawHotKey] = useState('');

    const { getLimitRect, getDevicePixelRatio, getContentScale, calculatedBoundaryRect } =
        useContext(DrawCoreContext);

    const getSelectedRect = useCallback(() => {
        return (
            getLimitRect() ?? {
                min_x: 0,
                min_y: 0,
                max_x: 0,
                max_y: 0,
            }
        );
    }, [getLimitRect]);
    const toolbarElementRef = useRef<HTMLDivElement>(null);

    const getSize = useCallback(() => {
        return {
            width: (toolbarElementRef.current?.clientWidth ?? 0) + BOX_SHADOW_WIDTH * 2,
            height:
                (toolbarElementRef.current?.clientHeight ?? 0) +
                BOX_SHADOW_WIDTH * 2 +
                token.marginXXS,
        };
    }, [token.marginXXS]);

    const {
        update: updateDrawToolbarStyleCore,
        reset: resetDrag,
        onMouseDown,
        onMouseMove,
        onMouseUp,
    } = useDragElement(
        useMemo(() => {
            return {
                getBaseOffset: (element) => {
                    const limitRect = getSelectedRect();
                    const devicePixelRatio = getDevicePixelRatio();
                    return {
                        x:
                            limitRect.max_x / devicePixelRatio -
                            BOX_SHADOW_WIDTH -
                            element.clientWidth,
                        y: limitRect.max_y / devicePixelRatio + token.marginXXS,
                    };
                },
            };
        }, [getDevicePixelRatio, getSelectedRect, token.marginXXS]),
    );

    const updateDrawToolbarStyle = useCallback(() => {
        const element = toolbarElementRef.current;
        if (!element) {
            return;
        }

        updateDrawToolbarStyleCore(element, getContentScale?.(), calculatedBoundaryRect);
    }, [updateDrawToolbarStyleCore, getContentScale, calculatedBoundaryRect]);

    const handleMouseDown = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            e.stopPropagation();
            onMouseDown(e);
        },
        [onMouseDown],
    );

    useEffect(() => {
        if (disabled) {
            return;
        }

        const handleMouseMove = (event: MouseEvent) => {
            if (!toolbarElementRef.current) {
                return;
            }

            onMouseMove(
                event,
                toolbarElementRef.current,
                getContentScale?.(),
                calculatedBoundaryRect,
            );
        };
        const handleMouseUp = () => {
            onMouseUp();
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [calculatedBoundaryRect, disabled, getContentScale, onMouseMove, onMouseUp]);

    const onToolClick = useCallback(
        (drawState: DrawState) => {
            const drawCoreAction = getDrawCoreAction();

            const prev = getDrawState();

            if (drawState === DrawState.Lock) {
                updateAppSettings(
                    AppSettingsGroup.Cache,
                    { enableLockDrawTool: !enableLockDrawToolRef.current },
                    true,
                    true,
                    false,
                    true,
                    false,
                );

                return;
            }

            if (drawState === DrawState.Confirm) {
                onConfirm();
                return;
            }

            let next = drawState;

            if (prev === drawState && prev !== DrawState.Idle) {
                if (drawState === DrawState.ScrollScreenshot) {
                    next = DrawState.Idle;
                } else {
                    next = DrawState.Select;
                }
            }

            let toolLocked = true;
            if (showLockDrawToolRef.current) {
                toolLocked = enableLockDrawToolRef.current;
            }

            switch (next) {
                case DrawState.Select:
                    drawCoreAction?.setActiveTool(
                        {
                            type: 'selection',
                        },
                        undefined,
                        next,
                    );
                    break;
                case DrawState.Rect:
                    drawCoreAction?.setActiveTool(
                        {
                            type: 'rectangle',
                            locked: toolLocked,
                        },
                        undefined,
                        next,
                    );
                    break;
                case DrawState.Diamond:
                    drawCoreAction?.setActiveTool(
                        {
                            type: 'diamond',
                            locked: toolLocked,
                        },
                        undefined,
                        next,
                    );
                    break;
                case DrawState.Ellipse:
                    drawCoreAction?.setActiveTool(
                        {
                            type: 'ellipse',
                            locked: toolLocked,
                        },
                        undefined,
                        next,
                    );
                    break;
                case DrawState.Arrow:
                    drawCoreAction?.setActiveTool(
                        {
                            type: 'arrow',
                            locked: toolLocked,
                        },
                        undefined,
                        next,
                    );
                    break;
                case DrawState.Line:
                    drawCoreAction?.setActiveTool(
                        {
                            type: 'line',
                            locked: toolLocked,
                        },
                        undefined,
                        next,
                    );
                    break;
                case DrawState.Pen:
                    drawCoreAction?.setActiveTool(
                        {
                            type: 'freedraw',
                            locked: toolLocked,
                        },
                        undefined,
                        next,
                    );
                    break;
                case DrawState.Text:
                    drawCoreAction?.setActiveTool(
                        {
                            type: 'text',
                            locked: toolLocked,
                        },
                        undefined,
                        next,
                    );
                    break;
                case DrawState.SerialNumber:
                    break;
                case DrawState.Eraser:
                    drawCoreAction?.setActiveTool(
                        {
                            type: 'eraser',
                            locked: toolLocked,
                        },
                        undefined,
                        next,
                    );
                    break;
                case DrawState.LaserPointer:
                    drawCoreAction?.setActiveTool(
                        {
                            type: 'laser',
                            locked: true,
                        },
                        undefined,
                        next,
                    );
                    break;
                case DrawState.MouseThrough:
                    drawCoreAction?.setActiveTool(
                        {
                            type: 'selection',
                        },
                        undefined,
                        next,
                    );
                    break;
                default:
                    break;
            }

            setDrawState(next);
        },
        [
            enableLockDrawToolRef,
            getDrawCoreAction,
            getDrawState,
            onConfirm,
            setDrawState,
            showLockDrawToolRef,
            updateAppSettings,
        ],
    );

    useAppSettingsLoad(
        useCallback(
            (settings: AppSettingsData) => {
                // 不显示锁定绘制工具
                setShowLockDrawTool(!settings[AppSettingsGroup.FunctionDraw].lockDrawTool);
                // 是否启用锁定绘制工具
                setEnableLockDrawTool(settings[AppSettingsGroup.Cache].enableLockDrawTool);
                setSwitchDrawHotKey(
                    settings[AppSettingsGroup.KeyEvent].fixedContentEnableDraw.hotKey,
                );
            },
            [setEnableLockDrawTool, setShowLockDrawTool, setSwitchDrawHotKey],
        ),
    );

    useStateSubscriber(
        ExcalidrawEventPublisher,
        useCallback(
            (params: ExcalidrawEventParams | undefined) => {
                if (params?.event === 'onChange') {
                    if (
                        params.params.appState.activeTool.type === 'selection' &&
                        getDrawState() !== DrawState.Select &&
                        getDrawState() !== DrawState.Idle
                    ) {
                        onToolClick(DrawState.Select);
                    }
                }
            },
            [getDrawState, onToolClick],
        ),
    );

    useImperativeHandle(
        actionRef,
        useCallback(() => {
            return {
                setTool: onToolClick,
                getSize,
            };
        }, [getSize, onToolClick]),
    );

    useEffect(() => {
        if (disabled) {
            toolbarElementRef.current!.style.opacity = '0';
        } else {
            setTimeout(() => {
                resetDrag();
                updateDrawToolbarStyle();

                toolbarElementRef.current!.style.opacity = '1';
            }, 17);
        }
    }, [disabled, resetDrag, updateDrawToolbarStyle]);

    const toolButtonProps = useMemo<ButtonProps>(() => {
        return {};
    }, []);

    const confirmButtonTitle = useMemo(() => {
        return intl.formatMessage(
            {
                id: 'draw.keyEventTooltip',
            },
            {
                message: intl.formatMessage({
                    id: 'draw.confirm',
                }),
                key: formatKey(switchDrawHotKey),
            },
        );
    }, [intl, switchDrawHotKey]);

    const dragTitle = useMemo(() => {
        return intl.formatMessage({ id: 'draw.drag' });
    }, [intl]);

    const dragWindowButtonTitle = useMemo(() => {
        return intl.formatMessage({ id: 'draw.dragWindow' });
    }, [intl]);

    return (
        <div className="fixed-content-draw-toolbar-container">
            <div className="fixed-content-draw-toolbar" ref={toolbarElementRef}>
                <Flex align="center" gap={token.paddingXS}>
                    <div className="drag-button" title={dragTitle} onMouseDown={handleMouseDown}>
                        <HolderOutlined />
                    </div>

                    <Button
                        {...toolButtonProps}
                        icon={
                            <DragWindowIcon
                                style={{
                                    fontSize: '1.15em',
                                }}
                            />
                        }
                        type={getButtonTypeByState(false)}
                        title={dragWindowButtonTitle}
                        onClick={() => {}}
                        onMouseDown={startFreeDrag}
                    />

                    {/* 选择状态 */}
                    <ToolButton
                        componentKey={KeyEventKey.SelectTool}
                        icon={<ArrowSelectIcon style={{ fontSize: '1.2em' }} />}
                        drawState={DrawState.Select}
                        buttonProps={toolButtonProps}
                        onClick={() => {
                            onToolClick(DrawState.Select);
                        }}
                    />

                    {showLockDrawTool && (
                        <>
                            {/* 锁定绘制工具 */}
                            <ToolButton
                                componentKey={KeyEventKey.LockDrawTool}
                                icon={<LockOutlined />}
                                drawState={DrawState.Lock}
                                enableState={enableLockDrawTool}
                                onClick={() => {
                                    onToolClick(DrawState.Lock);
                                }}
                            />
                        </>
                    )}

                    <div className="draw-toolbar-splitter" />

                    <ToolButton
                        componentKey={KeyEventKey.RectTool}
                        icon={<RectIcon style={{ fontSize: '1.08em' }} />}
                        drawState={DrawState.Rect}
                        buttonProps={toolButtonProps}
                        extraDrawState={[DrawState.Diamond]}
                        onClick={() => {
                            onToolClick(DrawState.Rect);
                        }}
                    />

                    {/* 椭圆 */}
                    <ToolButton
                        componentKey={KeyEventKey.EllipseTool}
                        icon={
                            <CircleIcon
                                style={{
                                    fontSize: '1em',
                                }}
                            />
                        }
                        buttonProps={toolButtonProps}
                        drawState={DrawState.Ellipse}
                        onClick={() => {
                            onToolClick(DrawState.Ellipse);
                        }}
                    />

                    {/* 箭头 */}
                    <ToolButton
                        componentKey={KeyEventKey.ArrowTool}
                        icon={
                            <ArrowIcon
                                style={{
                                    fontSize: '0.9em',
                                }}
                            />
                        }
                        buttonProps={toolButtonProps}
                        drawState={DrawState.Arrow}
                        extraDrawState={[DrawState.Line]}
                        onClick={() => {
                            onToolClick(DrawState.Arrow);
                        }}
                    />

                    {/* 画笔 */}
                    <ToolButton
                        componentKey={KeyEventKey.PenTool}
                        icon={<PenIcon style={{ fontSize: '1.15em' }} />}
                        buttonProps={toolButtonProps}
                        drawState={DrawState.Pen}
                        onClick={() => {
                            onToolClick(DrawState.Pen);
                        }}
                    />

                    {/* 文本 */}
                    <ToolButton
                        componentKey={KeyEventKey.TextTool}
                        icon={<TextIcon style={{ fontSize: '1.15em' }} />}
                        drawState={DrawState.Text}
                        buttonProps={toolButtonProps}
                        onClick={() => {
                            onToolClick(DrawState.Text);
                        }}
                    />

                    {/* 序列号 */}
                    <ToolButton
                        componentKey={KeyEventKey.SerialNumberTool}
                        icon={
                            <SerialNumberIcon
                                style={{
                                    fontSize: '1.16em',
                                }}
                            />
                        }
                        drawState={DrawState.SerialNumber}
                        buttonProps={toolButtonProps}
                        onClick={() => {
                            onToolClick(DrawState.SerialNumber);
                        }}
                    />

                    {/* 橡皮擦 */}
                    <ToolButton
                        componentKey={KeyEventKey.EraserTool}
                        icon={
                            <EraserIcon
                                style={{
                                    fontSize: '0.95em',
                                }}
                            />
                        }
                        drawState={DrawState.Eraser}
                        buttonProps={toolButtonProps}
                        onClick={() => {
                            onToolClick(DrawState.Eraser);
                        }}
                    />

                    <div className="draw-toolbar-splitter" />

                    <HistoryControls disable={disabled ?? false} />

                    <div className="draw-toolbar-splitter" />

                    <Button
                        {...toolButtonProps}
                        icon={
                            <CheckOutlined
                                style={{
                                    color: token.colorPrimary,
                                }}
                            />
                        }
                        type={getButtonTypeByState(false)}
                        title={confirmButtonTitle}
                        onClick={() => {
                            onToolClick(DrawState.Confirm);
                        }}
                    />
                </Flex>
            </div>

            <style jsx>{`
                .fixed-content-draw-toolbar-container {
                    position: fixed;
                    width: ${documentSize.width - BOX_SHADOW_WIDTH * 2}px;
                    pointer-events: none;
                    z-index: ${zIndexs.FullScreenDraw_Toolbar};
                    display: flex;
                    left: 0;
                    top: 0;
                }

                .fixed-content-draw-toolbar-container:hover {
                    z-index: ${zIndexs.FullScreenDraw_ToolbarHover};
                }

                .fixed-content-draw-toolbar {
                    opacity: 0;
                    transition: opacity ${token.motionDurationFast} ${token.motionEaseInOut};
                }

                .fixed-content-draw-toolbar :global(.ant-btn) :global(.ant-btn-icon) {
                    font-size: 24px;
                    display: flex;
                    align-items: center;
                }

                .fixed-content-draw-toolbar .drag-button {
                    color: ${token.colorTextQuaternary};
                    cursor: move;
                    font-size: 18px;
                }

                .fixed-content-draw-toolbar {
                    pointer-events: ${disabled ? 'none' : 'auto'};
                }

                .fixed-content-draw-toolbar {
                    padding: ${token.paddingXXS}px ${token.paddingSM}px;
                    box-sizing: border-box;
                    background-color: ${token.colorBgContainer};
                    border-radius: ${token.borderRadiusLG}px;
                    cursor: default; /* 防止非拖动区域也变成可拖动状态 */
                    color: ${token.colorText};
                    box-shadow: 0 0 3px 0px ${token.colorPrimaryHover};
                    transition: opacity ${token.motionDurationMid} ${token.motionEaseInOut};
                }

                .fixed-content-draw-toolbar :global(.draw-toolbar-splitter),
                .draw-toolbar-splitter {
                    width: 1px;
                    height: 1.6em;
                    background-color: ${token.colorBorder};
                    margin: 0 ${token.marginXS}px;
                }
            `}</style>
        </div>
    );
};
