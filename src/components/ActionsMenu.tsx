'use client';
import { useEffect, useRef, useState } from 'react';
import { MoreVertical, type LucideIcon } from 'lucide-react';

export type ActionsMenuItem = {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
};

export default function ActionsMenu({ items, disabled }: { items: ActionsMenuItem[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title="Actions"
        className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        <MoreVertical size={16} />
      </button>

      {open && !disabled && (
        <div className="absolute right-0 top-9 z-10 w-52 bg-white rounded-xl border border-gray-100 shadow-lg py-1.5">
          {items.map(({ label, icon: Icon, onClick, danger }) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                setOpen(false);
                onClick();
              }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-left transition-colors ${
                danger
                  ? 'text-red-500 hover:bg-red-50'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
