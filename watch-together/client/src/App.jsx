import { Navigate, Route, Routes, useParams } from 'react-router';
import HomePage from './pages/HomePage.jsx';
import RoomPage from './pages/RoomPage.jsx';

// key: при переходе в другую комнату страница создаётся заново, без остатков прошлой.
function RoomRoute() {
  const { roomId } = useParams();
  return <RoomPage key={roomId} roomId={roomId} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/room/:roomId" element={<RoomRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
