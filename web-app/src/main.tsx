import React from "react";
import { createRoot } from "react-dom/client";
import { useKimbuAuth } from "./hooks/useKimbuAuth";
import TaskList from "./components/TaskList";
import LoginPage from "./components/LoginPage";

function App() {
  const auth = useKimbuAuth();

  if (auth.loading && !auth.token) {
    return <div style={{ fontFamily: "system-ui", margin: "120px auto", textAlign: "center", color: "#999" }}>Loading…</div>;
  }

  if (!auth.token) {
    return <LoginPage auth={auth} />;
  }

  return <TaskList auth={auth} />;
}

createRoot(document.getElementById("root")!).render(<App />);
