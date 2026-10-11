"use client";

import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { moveTaskAction } from "@/lib/actions/tasks";
import { cn } from "@/lib/cn";
import { TASK_STATUS_LABELS, TASK_STATUSES, type TaskStatus } from "@/lib/domain";
import type { Task } from "@/lib/services/tasks";
import { TaskCard } from "./task-card";

type Columns = Record<TaskStatus, Task[]>;

export function groupByStatus(tasks: Task[]): Columns {
  const columns: Columns = { backlog: [], todo: [], in_progress: [], review: [], done: [] };
  for (const task of tasks) columns[task.status].push(task);
  return columns;
}

function isStatus(id: UniqueIdentifier): id is TaskStatus {
  return typeof id === "string" && (TASK_STATUSES as readonly string[]).includes(id);
}

function findColumn(columns: Columns, id: UniqueIdentifier): TaskStatus | null {
  if (isStatus(id)) return id;
  return TASK_STATUSES.find((status) => columns[status].some((task) => task.id === id)) ?? null;
}

function SortableCard({ task, onOpen }: { task: Task; onOpen: (task: Task) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("touch-none rounded-lg", isDragging && "opacity-40")}
      data-testid={`task-${task.id}`}
      {...attributes}
      {...listeners}
    >
      <TaskCard task={task} onOpen={() => onOpen(task)} />
    </li>
  );
}

function Column({
  status,
  tasks,
  onOpen,
  onAdd,
}: {
  status: TaskStatus;
  tasks: Task[];
  onOpen: (task: Task) => void;
  onAdd: (status: TaskStatus) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      aria-labelledby={`column-${status}`}
      data-testid={`column-${status}`}
      className="flex min-w-0 flex-col rounded-lg bg-surface-3/60"
    >
      <h2
        id={`column-${status}`}
        className="narrow flex items-center justify-between px-3 pt-2.5 pb-1.5 text-base font-semibold"
      >
        <span>
          {TASK_STATUS_LABELS[status]}
          <span className="num ml-2 text-sm font-normal text-ink-3">{tasks.length}</span>
        </span>
        <button
          type="button"
          onClick={() => onAdd(status)}
          aria-label={`Add a task to ${TASK_STATUS_LABELS[status]}`}
          className="rounded-md p-1 text-ink-3 hover:bg-surface-3 hover:text-ink"
        >
          <Plus aria-hidden="true" className="size-4" />
        </button>
      </h2>
      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          className={cn(
            "flex min-h-24 flex-1 flex-col gap-2 rounded-b-lg px-2 pt-1 pb-2",
            isOver && "bg-accent-soft/60",
          )}
        >
          {tasks.map((task) => (
            <SortableCard key={task.id} task={task} onOpen={onOpen} />
          ))}
        </ul>
      </SortableContext>
    </section>
  );
}

/**
 * Kanban board. Dragging updates local state at once; the move is then
 * persisted, and if the server rejects it the board returns to where it was.
 */
export function Board({
  tasks,
  onOpen,
  onAdd,
}: {
  tasks: Task[];
  onOpen: (task: Task) => void;
  onAdd: (status: TaskStatus) => void;
}) {
  const toast = useToast();
  const [columns, setColumns] = useState<Columns>(() => groupByStatus(tasks));
  const [active, setActive] = useState<Task | null>(null);
  const beforeDrag = useRef<Columns | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragStart(event: DragStartEvent) {
    const column = findColumn(columns, event.active.id);
    beforeDrag.current = columns;
    setActive(
      column ? (columns[column].find((task) => task.id === event.active.id) ?? null) : null,
    );
  }

  /** While dragging over another column, move the card there so the gap shows. */
  function handleDragOver(event: DragOverEvent) {
    const { active: dragged, over } = event;
    if (!over) return;
    setColumns((current) => {
      const from = findColumn(current, dragged.id);
      const to = findColumn(current, over.id);
      if (!from || !to || from === to) return current;
      const task = current[from].find((item) => item.id === dragged.id);
      if (!task) return current;
      const overIndex = current[to].findIndex((item) => item.id === over.id);
      const insertAt = overIndex >= 0 ? overIndex : current[to].length;
      return {
        ...current,
        [from]: current[from].filter((item) => item.id !== dragged.id),
        [to]: [
          ...current[to].slice(0, insertAt),
          { ...task, status: to },
          ...current[to].slice(insertAt),
        ],
      };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active: dragged, over } = event;
    const snapshot = beforeDrag.current;
    beforeDrag.current = null;
    setActive(null);
    if (!over || !snapshot) {
      if (snapshot) setColumns(snapshot);
      return;
    }

    const column = findColumn(columns, dragged.id);
    if (!column) return;
    const oldIndex = columns[column].findIndex((task) => task.id === dragged.id);
    const overIndex = columns[column].findIndex((task) => task.id === over.id);
    const ordered =
      overIndex >= 0 && overIndex !== oldIndex
        ? arrayMove(columns[column], oldIndex, overIndex)
        : columns[column];
    const next = { ...columns, [column]: ordered };

    const index = ordered.findIndex((task) => task.id === dragged.id);
    const original = findColumn(snapshot, dragged.id);
    const unchanged =
      original === column &&
      snapshot[column].map((task) => task.id).join() === ordered.map((task) => task.id).join();
    setColumns(next);
    if (unchanged) return;

    void moveTaskAction({
      id: Number(dragged.id),
      status: column,
      before_id: ordered[index - 1]?.id ?? null,
      after_id: ordered[index + 1]?.id ?? null,
    }).then((result) => {
      if (!result.ok) {
        setColumns(snapshot);
        toast.error(`The move was not saved: ${result.message}`);
      }
    });
  }

  return (
    <DndContext
      id="work-board"
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        if (beforeDrag.current) setColumns(beforeDrag.current);
        beforeDrag.current = null;
        setActive(null);
      }}
    >
      <div className="scroll-thin overflow-x-auto pb-2">
        <div className="grid min-w-[1080px] grid-cols-5 items-start gap-3">
          {TASK_STATUSES.map((status) => (
            <Column
              key={status}
              status={status}
              tasks={columns[status]}
              onOpen={onOpen}
              onAdd={onAdd}
            />
          ))}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? <TaskCard task={active} dragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}
