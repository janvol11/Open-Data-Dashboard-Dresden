"use client";

import React from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { useShallow } from "zustand/react/shallow";
import { useDashboardStore } from "@/store/useDashboardStore";
import { SortableWidget } from "./sortable-widget";

interface DashboardGridProps {
  widgets: Record<string, { component: React.ReactNode; className?: string }>;
}

export function DashboardGrid({ widgets }: DashboardGridProps) {
  const { widgetOrder, hiddenWidgets, setWidgetOrder } = useDashboardStore(
    useShallow((s) => ({
      widgetOrder: s.widgetOrder,
      hiddenWidgets: s.hiddenWidgets,
      setWidgetOrder: s.setWidgetOrder,
    }))
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Erst nach 8px Bewegung als Drag werten
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = widgetOrder.indexOf(active.id as string);
      const newIndex = widgetOrder.indexOf(over.id as string);
      const newOrder = arrayMove(widgetOrder, oldIndex, newIndex);
      setWidgetOrder(newOrder);
    }
  };

  const visibleWidgets = widgetOrder.filter((id) => !hiddenWidgets.includes(id));

  return (
    <DndContext
      // Feste ID nötig: sonst leitet dnd-kit die aria-describedby-Kennung aus
      // einem Zähler ab, der auf Server/Client unterschiedlich steht → Hydration-Fehler
      id="dashboard-widget-grid"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={visibleWidgets} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 auto-rows-[minmax(100px,auto)]">
          {visibleWidgets.map((id) => {
            const widget = widgets[id];
            if (!widget) return null;

            return (
              <SortableWidget
                key={id}
                id={id}
                className={widget.className || "md:col-span-12"}
              >
                {widget.component}
              </SortableWidget>
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
