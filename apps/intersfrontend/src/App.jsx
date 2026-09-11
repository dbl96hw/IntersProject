import { useEffect, useState } from 'react';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function App() {
  const [status, setStatus] = useState('checking backend...');

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((res) => res.json())
      .then((data) => setStatus(data.healthy ? 'backend is up' : 'backend responded, but unhealthy'))
      .catch(() => setStatus('could not reach backend — is intersbackend running?'));
  }, []);

  return (
    <main className="app">
      <h1>intersfrontend</h1>
      <p>{status}</p>
      <p className="hint">API URL: {API_URL}</p>
    </main>
  );
}

export default App;
