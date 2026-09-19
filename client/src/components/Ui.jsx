/**
 * Glitch - Ui.jsx
 * Designed and Developed by Saketh Phaneendra
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const push = useCallback((message, kind = 'info') => {
    if (!message) return;
    idRef.current += 1;
    const id = idRef.current;
    setToasts((list) => [...list, { id, message, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4200);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  return { toasts, push, dismiss };
}

export function Toasts({ toasts, dismiss }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={`toast toast--${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.message}
        </button>
      ))}
    </div>
  );
}

export function Status({ online, onlineText, offlineText }) {
  return (
    <span className={`status ${online ? 'status--on' : 'status--off'}`}>
      <span className="status__dot" aria-hidden="true" />
      {online ? onlineText : offlineText}
    </span>
  );
}

export function Equalizer({ active }) {
  return (
    <span className={`eq ${active ? 'eq--on' : ''}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export function Credit() {
  return <p className="credit">Designed and Developed by Saketh Phaneendra</p>;
}

export function BackLink({ label = 'Home', onClick }) {
  return (
    <button className="backlink" onClick={onClick}>
      ← {label}
    </button>
  );
}

/** Four big code digits, used for both master and wishlist codes. */
export function CodeDigits({ code }) {
  const digits = String(code || '····').split('');
  return (
    <div className="code" aria-label={`Code ${String(code || '').split('').join(' ')}`}>
      {digits.map((d, i) => (
        <span className="code__digit" key={i}>
          {d}
        </span>
      ))}
    </div>
  );
}

/** Four-box code entry that behaves like a one-time-password field. */
export function CodeInput({ value, onChange, onComplete, disabled }) {
  const refs = [useRef(null), useRef(null), useRef(null), useRef(null)];
  const chars = value.padEnd(4, ' ').slice(0, 4).split('');

  useEffect(() => {
    if (!disabled) refs[0].current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  const setAt = (index, char) => {
    const next = value.padEnd(4, ' ').split('');
    next[index] = char;
    const joined = next.join('').replace(/ /g, '').slice(0, 4);
    onChange(joined);
    return joined;
  };

  const handleChange = (index) => (event) => {
    const digit = event.target.value.replace(/\D/g, '').slice(-1);
    if (!digit) return;
    const joined = setAt(index, digit);
    if (index < 3) refs[index + 1].current?.focus();
    if (joined.length === 4 && onComplete) onComplete(joined);
  };

  const handleKeyDown = (index) => (event) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      const next = value.split('');
      if (next[index]) {
        next.splice(index, 1);
        onChange(next.join(''));
      } else if (index > 0) {
        next.splice(index - 1, 1);
        onChange(next.join(''));
        refs[index - 1].current?.focus();
      }
    }
    if (event.key === 'Enter' && value.length === 4 && onComplete) onComplete(value);
  };

  const handlePaste = (event) => {
    const pasted = (event.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 4);
    if (!pasted) return;
    event.preventDefault();
    onChange(pasted);
    refs[Math.min(pasted.length, 3)].current?.focus();
    if (pasted.length === 4 && onComplete) onComplete(pasted);
  };

  return (
    <div className="codeinput">
      {chars.map((char, index) => (
        <input
          key={index}
          ref={refs[index]}
          className="codeinput__box"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={1}
          disabled={disabled}
          value={char.trim()}
          onChange={handleChange(index)}
          onKeyDown={handleKeyDown(index)}
          onPaste={handlePaste}
          aria-label={`Digit ${index + 1}`}
        />
      ))}
    </div>
  );
}
