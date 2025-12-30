
import React from 'react';
import { cn } from '../ui/core';

export const WritingCanvas = ({ children, className, ...props }) => {
    return (
        <div className="flex-1 h-full overflow-y-auto relative bg-background scroll-smooth" {...props}>
            <div className={cn(
                "max-w-[850px] mx-auto min-h-screen my-8 p-12 bg-surface shadow-paper transition-shadow duration-300",
                "hover:shadow-paper-hover",
                className
            )}>
                <article className="prose prose-lg prose-slate max-w-none font-serif leading-relaxed text-ink-900 empty:before:content-['Start_writing...'] empty:before:text-ink-400">
                    {children}
                </article>
            </div>

            {/* Bottom padding for scroll comfort */}
            <div className="h-[30vh]" />
        </div>
    );
};
