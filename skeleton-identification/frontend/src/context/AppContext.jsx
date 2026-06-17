import { createContext, useContext, useState, useCallback } from 'react';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [activeTab, setActiveTab] = useState('live');
  const [systemOnline, setSystemOnline] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);

  const value = {
    activeTab,
    setActiveTab,
    systemOnline,
    setSystemOnline,
    wsConnected,
    setWsConnected,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  return useContext(AppContext);
}
