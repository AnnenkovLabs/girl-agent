import { useEffect } from "react";
import { useStore } from "./lib/store";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { ApplyPill } from "./components/ApplyPill";
import { Toasts } from "./components/Toasts";
import { CommandModal } from "./components/CommandModal";
import { LogsPage } from "./pages/LogsPage";
import { ConfigurationPage } from "./pages/ConfigurationPage";
import { MemoryPage } from "./pages/MemoryPage";
import { AddonsPage } from "./pages/AddonsPage";
import { AssistantPage } from "./pages/AssistantPage";
import { RelationshipPage } from "./pages/RelationshipPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { SetupFlow } from "./pages/SetupFlow";

export function App() {
  const ready = useStore(s => s.ready);
  const tab = useStore(s => s.tab);
  const showSetup = useStore(s => s.showSetup);
  const sidebarOpen = useStore(s => s.sidebarOpen);
  const init = useStore(s => s.init);

  useEffect(() => { void init(); }, [init]);

  if (!ready) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar" data-open={sidebarOpen}>
          <Sidebar />
        </aside>
        <div className="main">
          <Topbar />
          <div className="content">
            {tab === "logs" && <LogsPage />}
            {tab === "configuration" && <ConfigurationPage />}
            {tab === "memory" && <MemoryPage />}
            {tab === "addons" && <AddonsPage />}
            {tab === "assistant" && <AssistantPage />}
            {tab === "relationship" && <RelationshipPage />}
            {tab === "diagnostics" && <DiagnosticsPage />}
          </div>
        </div>
      </div>
      <ApplyPill />
      <Toasts />
      <CommandModal />
      {showSetup && <SetupFlow />}
    </>
  );
}
