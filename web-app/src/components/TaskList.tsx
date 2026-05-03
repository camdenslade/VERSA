import { useState, useRef } from "react";
import { type KimbuSession } from "../hooks/useKimbuAuth";
import { useVersaStore, type List } from "../hooks/useVersaStore";

const DEFAULT_LIST: List = { id: "default", name: "Tasks", lastModified: 0 };

export default function TaskList({ auth }: { auth: KimbuSession }) {
  const {
    tasks, lists, connected, error, authLoading,
    addTask, updateTask, toggleTask, deleteTask,
    addList, renameList, deleteList,
  } = useVersaStore(auth);

  const [activeListId, setActiveListId]   = useState("default");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskDraft, setTaskDraft]         = useState("");
  const [addingTask, setAddingTask]       = useState(false);
  const [newTaskDraft, setNewTaskDraft]   = useState("");
  const [renamingListId, setRenamingListId] = useState<string | null>(null);
  const [listDraft, setListDraft]           = useState("");
  const taskInputRef    = useRef<HTMLInputElement>(null);
  const newTaskInputRef = useRef<HTMLInputElement>(null);
  const listInputRef    = useRef<HTMLInputElement>(null);

  function startAddTask() {
    setNewTaskDraft("");
    setAddingTask(true);
    setTimeout(() => newTaskInputRef.current?.focus(), 0);
  }

  function commitNewTask() {
    const trimmed = newTaskDraft.trim();
    setAddingTask(false);
    setNewTaskDraft("");
    if (trimmed) addTask(trimmed, activeListId);
  }

  const allLists: List[] = [DEFAULT_LIST, ...lists];
  const activeList       = allLists.find(l => l.id === activeListId) ?? DEFAULT_LIST;
  const visibleTasks     = tasks.filter(t => t.listId === activeListId);

  function startEditTask(id: string, content: string) {
    setEditingTaskId(id);
    setTaskDraft(content);
    setTimeout(() => taskInputRef.current?.select(), 0);
  }

  function commitTaskEdit(id: string, original: string) {
    const trimmed = taskDraft.trim();
    setEditingTaskId(null);
    if (trimmed && trimmed !== original) updateTask(id, trimmed);
  }

  function startRenameList(id: string, name: string) {
    setRenamingListId(id);
    setListDraft(name);
    setTimeout(() => listInputRef.current?.select(), 0);
  }

  function commitListRename(id: string) {
    const trimmed = listDraft.trim();
    setRenamingListId(null);
    if (trimmed) renameList(id, trimmed);
  }

  async function handleAddList() {
    const id = await addList("New list");
    setActiveListId(id);
    setRenamingListId(id);
    setListDraft("New list");
    setTimeout(() => listInputRef.current?.select(), 0);
  }

  async function handleDeleteList(id: string) {
    await deleteList(id);
    if (activeListId === id) setActiveListId("default");
  }

  return (
    <div style={{ display: "flex", fontFamily: "system-ui", maxWidth: 680, margin: "40px auto", padding: "0 16px", gap: 24 }}>

      {/* Sidebar */}
      <div style={{ width: 180, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: 1 }}>Lists</span>
          <button onClick={handleAddList} style={{ background: "none", border: "none", cursor: "pointer", color: "#999", fontSize: 18, lineHeight: 1, padding: 0 }} title="New list">+</button>
        </div>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {allLists.map(list => (
            <li key={list.id}
              style={{ display: "flex", alignItems: "center", gap: 4, borderRadius: 6,
                background: list.id === activeListId ? "#f0f0f0" : "none",
                padding: "4px 6px", marginBottom: 2, cursor: "pointer" }}
              onClick={() => { if (renamingListId !== list.id) setActiveListId(list.id); }}>
              {renamingListId === list.id ? (
                <input
                  ref={listInputRef}
                  value={listDraft}
                  onChange={e => setListDraft(e.target.value)}
                  onBlur={() => commitListRename(list.id)}
                  onKeyDown={e => {
                    if (e.key === "Enter") { e.preventDefault(); commitListRename(list.id); }
                    if (e.key === "Escape") setRenamingListId(null);
                  }}
                  style={{ flex: 1, border: "none", borderBottom: "1px solid #999", outline: "none", fontSize: 14, background: "transparent", padding: "1px 0" }}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span
                  onDoubleClick={e => { e.stopPropagation(); if (list.id !== "default") startRenameList(list.id, list.name); }}
                  style={{ flex: 1, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {list.name}
                </span>
              )}
              <span style={{ fontSize: 12, color: "#bbb", flexShrink: 0 }}>
                {tasks.filter(t => t.listId === list.id).length}
              </span>
              {list.id !== "default" && renamingListId !== list.id && (
                <button
                  onClick={e => { e.stopPropagation(); handleDeleteList(list.id); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#ddd", fontSize: 13, padding: 0, flexShrink: 0 }}
                  title="Delete list">✕</button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Main */}
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>{activeList.name}</h1>
          <span style={{ fontSize: 13, color: connected ? "green" : "gray" }}>
            {authLoading ? "⟳ auth…" : connected ? "● live" : "○ offline"}
          </span>
          <button onClick={startAddTask} style={{ marginLeft: "auto" }}>
            + Add
          </button>
          <button onClick={auth.logout} style={{ fontSize: 12, color: "#999", background: "none", border: "none", cursor: "pointer" }}>
            Sign out
          </button>
        </div>

        {error && (
          <div style={{ background: "#fee", border: "1px solid #f99", borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#c00" }}>
            {error}
          </div>
        )}

        {visibleTasks.length === 0 && !addingTask && !error && (
          <p style={{ color: "#999", fontSize: 14 }}>No tasks yet. Hit + or add one from iOS.</p>
        )}

        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {addingTask && (
            <li style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #eee" }}>
              <span style={{ fontSize: 18, color: "#ccc", flexShrink: 0 }}>○</span>
              <input
                ref={newTaskInputRef}
                value={newTaskDraft}
                onChange={e => setNewTaskDraft(e.target.value)}
                onBlur={commitNewTask}
                onKeyDown={e => {
                  if (e.key === "Enter") { e.preventDefault(); commitNewTask(); }
                  if (e.key === "Escape") { setAddingTask(false); setNewTaskDraft(""); }
                }}
                placeholder="Task name"
                style={{ flex: 1, border: "none", borderBottom: "1px solid #999", outline: "none", fontSize: "inherit", padding: "1px 0", background: "transparent" }}
              />
            </li>
          )}
          {visibleTasks.map(task => (
            <li key={task.id}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #eee" }}>
              <span onClick={() => toggleTask(task.id)}
                style={{ fontSize: 18, color: task.isCompleted ? "green" : "#ccc", cursor: "pointer", flexShrink: 0 }}>
                {task.isCompleted ? "✓" : "○"}
              </span>
              {editingTaskId === task.id ? (
                <input
                  ref={taskInputRef}
                  value={taskDraft}
                  onChange={e => setTaskDraft(e.target.value)}
                  onBlur={() => commitTaskEdit(task.id, task.content)}
                  onKeyDown={e => {
                    if (e.key === "Enter") { e.preventDefault(); commitTaskEdit(task.id, task.content); }
                    if (e.key === "Escape") setEditingTaskId(null);
                  }}
                  style={{ flex: 1, border: "none", borderBottom: "1px solid #999", outline: "none", fontSize: "inherit", padding: "1px 0", background: "transparent" }}
                />
              ) : (
                <span onClick={() => startEditTask(task.id, task.content)}
                  style={{ flex: 1, textDecoration: task.isCompleted ? "line-through" : "none", color: task.isCompleted ? "#999" : "#000", cursor: "text" }}>
                  {task.content}
                </span>
              )}
              <button onClick={() => deleteTask(task.id)}
                style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 16, padding: "0 4px", flexShrink: 0 }}>✕</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
