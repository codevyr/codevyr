import { useState } from 'react';
import { useHover, useInteractions, useFloating } from '@floating-ui/react';

export function NodeHover() {
    const [isOpen, setIsOpen] = useState(false);

    const { refs, floatingStyles, context } = useFloating({
        open: isOpen,
        onOpenChange: setIsOpen,
    });

    const hover = useHover(context);

    const { getReferenceProps, getFloatingProps } = useInteractions([
        hover,
    ]);

    return (
        <>
            <div ref={refs.setReference} {...getReferenceProps()}>
                Reference element
            </div>
            {isOpen && (
                <div
                    ref={refs.setFloating}
                    style={floatingStyles}
                    {...getFloatingProps()}
                >
                    Floating element
                </div>
            )}
        </>
    );
}