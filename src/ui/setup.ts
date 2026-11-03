import { describeSettings, normalizeSettings, type GameSettings } from './settings';

const form = () => document.getElementById('setup-form') as HTMLFormElement;

/** Reads the setup form into validated settings. */
export function readSetupForm(): GameSettings {
  const data = new FormData(form());
  return normalizeSettings({
    players: data.get('players'),
    difficulty: data.get('difficulty'),
    length: data.get('length'),
    rounds: data.get('rounds'),
    scoreLimit: data.get('scoreLimit'),
  });
}

function setRadio(name: string, value: string): void {
  const input = form().querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
}

export function writeSetupForm(s: GameSettings): void {
  setRadio('players', String(s.players));
  setRadio('difficulty', s.difficulty);
  setRadio('length', s.length);
  form().querySelector<HTMLInputElement>('input[name="rounds"]')!.value = String(s.rounds);
  form().querySelector<HTMLInputElement>('input[name="scoreLimit"]')!.value = String(s.scoreLimit);
  updateSetupSummary();
}

/** Shows every setting that will apply before the game starts. */
export function updateSetupSummary(): void {
  const list = document.getElementById('setup-summary-list')!;
  list.replaceChildren(
    ...describeSettings(readSetupForm()).map((line) => {
      const li = document.createElement('li');
      li.textContent = line;
      return li;
    }),
  );
}

export function bindSetup(onStart: (s: GameSettings) => void, onResume: () => void): void {
  const f = form();
  f.addEventListener('input', updateSetupSummary);
  f.addEventListener('change', (e) => {
    // Typing a number selects its length mode.
    const t = e.target as HTMLInputElement;
    if (t.name === 'rounds') setRadio('length', 'rounds');
    if (t.name === 'scoreLimit') setRadio('length', 'score');
    updateSetupSummary();
  });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    onStart(readSetupForm());
  });
  document.getElementById('resume-game')!.addEventListener('click', onResume);
}
