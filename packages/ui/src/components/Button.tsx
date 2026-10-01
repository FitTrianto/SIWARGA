import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
};

export function Button({ children, className = "", ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={
        "w-full h-[56px] rounded-xl flex items-center justify-center gap-2 " +
        "shadow-md tracking-wide transition-all active:scale-[0.98] " +
        "disabled:opacity-50 disabled:pointer-events-none " +
        className
      }
    >
      {children}
    </button>
  );
}