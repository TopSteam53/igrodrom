import { useEffect, useRef } from 'react';
import { createPlayer } from './createPlayer.js';

// Место под плеер. Создаёт адаптер нужной площадки и отдаёт его наружу через onAdapter.
export default function VideoPlayer({ provider, onAdapter }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const adapter = createPlayer(provider, containerRef.current);
    onAdapter(adapter);
    return () => {
      onAdapter(null);
      adapter.destroy();
    };
  }, [provider, onAdapter]);

  return <div className="player" ref={containerRef} />;
}
