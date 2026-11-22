"use client";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="rounded-full bg-[#2a78d6] px-4 py-1.5 text-sm font-semibold text-white">
      Print
    </button>
  );
}
