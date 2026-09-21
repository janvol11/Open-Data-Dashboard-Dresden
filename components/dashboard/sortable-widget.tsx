"use client";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

interface SortableWidgetProps {
  id: string;
  children: React.ReactNode;
  className?: string;
}

export function SortableWidget({ id, children, className }: SortableWidgetProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative rounded-xl border bg-card shadow-sm flex flex-col group",
        isDragging && "opacity-50 ring-2 ring-primary ring-offset-2 z-50",
        className
      )}
    >
      {/* Nur bei Hover sichtbar, auf Mobile immer */}
      <div
        {...attributes}
        {...listeners}
        className="absolute top-2 right-2 p-1.5 rounded-md text-muted-foreground/50 hover:bg-muted hover:text-foreground cursor-grab active:cursor-grabbing z-10 transition-colors hidden md:flex md:opacity-0 md:group-hover:opacity-100"
        title="Widget verschieben"
      >
        <GripHorizontal className="h-4 w-4" />
      </div>

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
        {children}
      </div>
    </div>
  );
}
