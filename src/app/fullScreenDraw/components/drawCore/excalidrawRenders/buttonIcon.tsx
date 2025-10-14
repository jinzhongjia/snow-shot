import { ExcalidrawPropsCustomOptions } from '@mg-chao/excalidraw/types';
import React from 'react';
import { Button } from 'antd';
import { getButtonTypeByState } from '@/app/draw/components/drawToolbar/extra';

export const ButtonIcon = React.forwardRef<
    HTMLButtonElement,
    React.ComponentProps<
        NonNullable<NonNullable<ExcalidrawPropsCustomOptions['pickerRenders']>['CustomButtonIcon']>
    >
>((props, ref) => {
    const { title, testId, active, icon, onClick } = props;
    return (
        <Button
            ref={ref}
            key={title}
            title={title}
            type={getButtonTypeByState(active ?? false)}
            data-testid={testId}
            onClick={onClick}
            style={{
                marginLeft: 'auto',
                paddingInline: '8px',
            }}
        >
            <div className="radio-button-icon">{icon}</div>
        </Button>
    );
});

ButtonIcon.displayName = 'ButtonIcon';
