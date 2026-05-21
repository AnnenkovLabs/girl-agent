import { useEffect, useState } from "react";
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
import { SetupManagerPage, isSetupManagerPath } from "./pages/SetupManagerPage";
import { ContactsPage, isContactsPath } from "./pages/ContactsPage";
import { InboxPage, isInboxPath } from "./pages/InboxPage";
import { AuthGate } from "./components/AuthGate";

export function App() {
  const ready = useStore(s => s.ready);
  const tab = useStore(s => s.tab);
  const showSetup = useStore(s => s.showSetup);
  const sidebarOpen = useStore(s => s.sidebarOpen);
  const init = useStore(s => s.init);

  // Лёгкий path-based роут: визард менеджера живёт по `/setup/manager`,
  // страница контактов — по `/contacts/:slug`, инбокс — по `/inbox/:slug`.
  // Остальное — обычный one-page UI с табами в zustand-стейте.
  const [setupManager, setSetupManager] = useState<boolean>(isSetupManagerPath());
  const [contactsPage, setContactsPage] = useState<boolean>(isContactsPath());
  const [inboxPage, setInboxPage] = useState<boolean>(isInboxPath());
  useEffect(() => {
    function onPop() {
      setSetupManager(isSetupManagerPath());
      setContactsPage(isContactsPath());
      setInboxPage(isInboxPath());
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => { void init(); }, [init]);

  if (!ready) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <AuthGate>
      {setupManager ? (
        <SetupManagerPage />
      ) : contactsPage ? (
        <ContactsPage />
      ) : inboxPage ? (
        <InboxPage />
      ) : (
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
      )}
      <ApplyPill />
      <Toasts />
      <CommandModal />
      {showSetup && !setupManager && !contactsPage && !inboxPage && <SetupFlow />}
    </AuthGate>
  );
}
