import { useRef } from "react";
import type { ChangeEvent } from "react";

export const PIN_LENGTH = 6;

type PinInputProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  visible?: boolean;
  disabled?: boolean;
};

export function PinInput({ id, value, onChange, visible = false, disabled = false }: PinInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleInput(e: ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH);
    onChange(digits);
  }

  return (
    <div className="relative flex items-center justify-center">
      <input
        id={id}
        ref={inputRef}
        value={value}
        onChange={handleInput}
        inputMode="numeric"
        autoComplete="off"
        maxLength={PIN_LENGTH}
        pattern="[0-9]*"
        type={visible ? "text" : "password"}
        disabled={disabled}
        aria-label="PIN masuk 6 angka"
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 text-center tracking-[1.5em]"
      />
      <div className="grid grid-cols-6 gap-2 w-full max-w-xs py-1">
        {Array.from({ length: PIN_LENGTH }, (_, i) => {
          const filled = i < value.length;
          return (
            <div
              key={i}
              className={
                "h-14 rounded-lg flex items-center justify-center font-headline-md text-headline-md shadow-sm transition-all " +
                (filled ? "bg-surface-container-highest text-primary font-bold" : "bg-surface-container-low text-outline")
              }
            >
              {filled ? (visible ? value[i] : "•") : "-"}
            </div>
          );
        })}
      </div>
    </div>
  );
}