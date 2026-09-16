import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import DianaPage from './pages/interns/DianaPage';
import JosePage from './pages/interns/JosePage';
import PaulaPage from './pages/interns/PaulaPage';
import SebastianPage from './pages/interns/SebastianPage';
import TristanPage from './pages/interns/TristanPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/diana" element={<DianaPage />} />
        <Route path="/jose" element={<JosePage />} />
        <Route path="/paula" element={<PaulaPage />} />
        <Route path="/sebastian" element={<SebastianPage />} />
        <Route path="/tristan" element={<TristanPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
