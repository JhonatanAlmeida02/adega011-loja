"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Lista reordenável por arrastar (mouse, toque e teclado: Espaço + setas).
 * `onReordenar` recebe a lista na nova ordem.
 */
export function ListaOrdenavel<T extends { id: string }>({
  itens,
  onReordenar,
  renderizar,
  rotulo,
  desabilitado,
}: {
  itens: T[];
  onReordenar: (novos: T[]) => void;
  renderizar: (item: T) => React.ReactNode;
  rotulo: (item: T) => string;
  desabilitado?: boolean;
}) {
  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const aoSoltar = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const de = itens.findIndex((i) => i.id === active.id);
    const para = itens.findIndex((i) => i.id === over.id);
    onReordenar(arrayMove(itens, de, para));
  };

  return (
    <DndContext
      sensors={sensores}
      collisionDetection={closestCenter}
      onDragEnd={aoSoltar}
      accessibility={{
        screenReaderInstructions: {
          draggable: "Para reordenar, pressione espaço, use as setas para mover e espaço para soltar. Esc cancela.",
        },
        announcements: {
          onDragStart: ({ active }) => `Pegou ${nomeDe(active.id)}.`,
          onDragOver: ({ active, over }) =>
            over ? `${nomeDe(active.id)} sobre a posição de ${nomeDe(over.id)}.` : `${nomeDe(active.id)} fora da lista.`,
          onDragEnd: ({ active, over }) =>
            over ? `${nomeDe(active.id)} solto na posição de ${nomeDe(over.id)}.` : `${nomeDe(active.id)} solto.`,
          onDragCancel: ({ active }) => `Movimento de ${nomeDe(active.id)} cancelado.`,
        },
      }}
    >
      <SortableContext items={itens} strategy={verticalListSortingStrategy} disabled={desabilitado}>
        <ul className="space-y-2">
          {itens.map((item) => (
            <ItemOrdenavel key={item.id} id={item.id} rotulo={rotulo(item)} desabilitado={desabilitado}>
              {renderizar(item)}
            </ItemOrdenavel>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );

  function nomeDe(id: string | number) {
    const item = itens.find((i) => i.id === id);
    return item ? rotulo(item) : "item";
  }
}

function ItemOrdenavel({
  id,
  rotulo,
  desabilitado,
  children,
}: {
  id: string;
  rotulo: string;
  desabilitado?: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: desabilitado,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 rounded-2xl border border-borda bg-superficie p-2 pr-3",
        isDragging && "relative z-10 border-rosa shadow-2xl shadow-rosa/20",
      )}
    >
      {!desabilitado && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="grid size-11 shrink-0 cursor-grab touch-none place-items-center rounded-xl text-suave hover:bg-superficie-3 hover:text-branco active:cursor-grabbing"
          aria-label={`Arrastar ${rotulo}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-5" />
        </button>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}
