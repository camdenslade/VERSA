import { type KimbuSession } from "../hooks/useKimbuAuth";
import { useVersaStore } from "../hooks/useVersaStore";

export default function TaskList({ auth }: { auth: KimbuSession }) {
  const { tasks, connected, error, authLoading, addTask, toggleTask, deleteTask } = useVersaStore(auth);

  return (
    <div style={{ fontFamily: "system-ui", maxWidth: 480, margin: "40px auto", padding: "0 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Versa</h1>
        <span style={{ fontSize: 13, color: connected ? "green" : "gray" }}>
          {authLoading ? "⟳ auth…" : connected ? "● live" : "○ offline"}
        </span>
        <button onClick={() => addTask(`Task ${tasks.length + 1}`)} style={{ marginLeft: "auto" }}>
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

      {tasks.length === 0 && !error && (
        <p style={{ color: "#999", fontSize: 14 }}>No tasks yet. Tap + or add one from iOS.</p>
      )}

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {tasks.map(task => (
          <li key={task.id}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
              borderBottom: "1px solid #eee" }}>
            <span onClick={() => toggleTask(task.id)} style={{ fontSize: 18, color: task.isCompleted ? "green" : "#ccc", cursor: "pointer" }}>
              {task.isCompleted ? "✓" : "○"}
            </span>
            <span onClick={() => toggleTask(task.id)} style={{ flex: 1, textDecoration: task.isCompleted ? "line-through" : "none", color: task.isCompleted ? "#999" : "#000", cursor: "pointer" }}>
              {task.content}
            </span>
            <button onClick={() => deleteTask(task.id)} style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 16, padding: "0 4px" }}>✕</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
