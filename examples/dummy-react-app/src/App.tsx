import { useState } from "react";
import { releaseNotes } from "./releaseNotes";

export function App() {
  const [count, setCount] = useState(0);

  return (
    <main className="app">
      <h1>Dummy React App</h1>
      <p>A throwaway app used to exercise deployment tooling.</p>

      <button type="button" onClick={() => setCount((c) => c + 1)}>
        deployed {count} times
      </button>

      <h2>Release notes</h2>
      <ul>
        {releaseNotes.map((note) => (
          <li key={note.version}>
            <strong>{note.version}</strong> — {note.summary}
          </li>
        ))}
      </ul>
    </main>
  );
}
