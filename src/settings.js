// Player settings: defaults, persistence in localStorage, and the settings
// panel shown on the pause screen.
const STORAGE_KEY = 'voxel-test-settings';

export const SETTINGS = [
  { id: 'renderDistance', label: 'Block render distance', type: 'range', min: 2, max: 16, step: 1, value: 8, unit: ' chunks' },
  {
    id: 'distantTerrain', label: 'Distant terrain', type: 'select', value: 2048,
    options: [[0, 'Off'], [1024, '1 km'], [2048, '2 km'], [4096, '4 km']],
  },
  {
    id: 'lodDetail', label: 'Distant detail', type: 'select', value: 2.25,
    options: [[1.5, 'Low'], [2.25, 'Medium'], [3, 'High']],
  },
  { id: 'fog', label: 'Fog', type: 'checkbox', value: true },
  { id: 'fov', label: 'Field of view', type: 'range', min: 50, max: 110, step: 1, value: 75, unit: '°' },
  { id: 'sensitivity', label: 'Mouse sensitivity', type: 'range', min: 10, max: 300, step: 5, value: 100, unit: '%' },
  { id: 'invertY', label: 'Invert mouse Y', type: 'checkbox', value: false },
  { id: 'showDebug', label: 'Show debug info', type: 'checkbox', value: true },
];

export class Settings {
  constructor() {
    this.values = Object.fromEntries(SETTINGS.map((s) => [s.id, s.value]));
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      for (const s of SETTINGS) {
        const v = saved[s.id];
        if (typeof v !== typeof s.value) continue;
        if (s.type === 'select' && !s.options.some(([o]) => o === v)) continue;
        if (s.type === 'range' && (v < s.min || v > s.max)) continue;
        this.values[s.id] = v;
      }
    } catch (e) { /* storage unavailable: use defaults */ }
    this.listeners = [];
  }

  get(id) {
    return this.values[id];
  }

  set(id, value) {
    this.values[id] = value;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values)); } catch (e) { /* ignore */ }
    for (const fn of this.listeners) fn(id, value);
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  reset() {
    for (const s of SETTINGS) this.set(s.id, s.value);
  }

  // Build the controls into `container`. Returns a function that refreshes
  // the controls from the current values.
  buildPanel(container) {
    container.innerHTML = '';
    const rows = SETTINGS.map((s) => {
      const row = document.createElement('label');
      row.className = `setting setting-${s.type}`;
      row.htmlFor = `set-${s.id}`;
      const name = document.createElement('span');
      name.className = 'setting-name';
      name.textContent = s.label;
      const input = document.createElement(s.type === 'select' ? 'select' : 'input');
      input.id = `set-${s.id}`;
      if (s.type === 'select') {
        for (const [value, text] of s.options) input.add(new Option(text, value));
      } else {
        input.type = s.type;
      }
      if (s.type === 'range') {
        input.min = s.min;
        input.max = s.max;
        input.step = s.step;
      }
      const out = document.createElement('output');
      out.className = 'setting-value';
      out.htmlFor = input.id;
      const show = () => {
        if (s.type === 'range') {
          input.value = this.values[s.id];
          out.textContent = `${this.values[s.id]}${s.unit}`;
        } else if (s.type === 'select') {
          input.value = String(this.values[s.id]);
        } else {
          input.checked = this.values[s.id];
        }
      };
      input.addEventListener('input', () => {
        this.set(s.id, s.type === 'checkbox' ? input.checked : Number(input.value));
        show();
      });
      show();
      row.append(name, input);
      if (s.type === 'range') row.append(out);
      container.append(row);
      return show;
    });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'link-button';
    reset.textContent = 'Reset to defaults';
    reset.addEventListener('click', () => {
      this.reset();
      rows.forEach((show) => show());
    });
    container.append(reset);
    return () => rows.forEach((show) => show());
  }
}
