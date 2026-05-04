import { createRoot } from "react-dom/client";
import { useKimbuAuth } from "./hooks/useKimbuAuth";
import TaskList from "./components/TaskList";
import LoginPage from "./components/LoginPage";
import BenchPage from "./components/BenchPage";
import PentestPage from "./components/PentestPage";

const path = window.location.pathname;

if (path === "/bench") {
  createRoot(document.getElementById("root")!).render(<BenchPage />);
} else if (path === "/pentest") {
  createRoot(document.getElementById("root")!).render(<PentestPage />);
} else {
  function App() {
    const auth = useKimbuAuth();
    if (auth.loading && !auth.token) {
      return <div style={{ fontFamily: "system-ui", margin: "120px auto", textAlign: "center", color: "#999" }}>Loading…</div>;
    }
    if (!auth.token) return <LoginPage auth={auth} />;
    return <TaskList auth={auth} />;
  }
  createRoot(document.getElementById("root")!).render(<App />);
}
