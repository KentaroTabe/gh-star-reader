"use client";

import { languageColor, readableInk } from "@/lib/languageColors";
import { OTHER, type LanguageShare } from "@/lib/languages";

/**
 * Below this the segment is too narrow to hold a word, and a clipped fragment
 * of a language name reads worse than none. Those keep the legend and the
 * tooltip.
 */
const LABEL_MIN_SHARE = 0.07;

type Props = {
  shares: LanguageShare[];
  selected: string | null;
  onSelect: (name: string | null) => void;
};

function percent(share: number): string {
  const value = share * 100;
  return value >= 10 ? `${Math.round(value)}%` : `${value.toFixed(1)}%`;
}

function colorFor(name: string): string {
  return name === OTHER ? "#8f9a95" : languageColor(name);
}

/**
 * What the whole shelf is written in, as one bar.
 *
 * Each repository carries the same weight, so this answers "what do I tend to
 * star" rather than "which repository is biggest". Selecting a segment narrows
 * the list to the repositories that language leads — which is why the filter
 * dropdown is gone: the picture and the control are the same thing.
 */
export default function LanguageBar({ shares, selected, onSelect }: Props) {
  if (shares.length === 0) return null;

  return (
    <div className="langbar">
      <div className="langbar__rail" role="group" aria-label="言語構成">
        {shares.map((item) => (
          <button
            key={item.name}
            type="button"
            className="langbar__segment"
            data-selected={item.name === selected}
            data-dimmed={selected !== null && item.name !== selected}
            style={{
              flexGrow: item.share,
              background: colorFor(item.name),
              color: readableInk(colorFor(item.name)),
            }}
            title={`${item.name} ${percent(item.share)} — 主に使うのは ${item.repoCount} 件${
              item.folded.length > 0 ? `\n${item.folded.join(", ")}` : ""
            }`}
            aria-label={`${item.name} ${percent(item.share)}、主に使うのは ${item.repoCount} 件`}
            aria-pressed={item.name === selected}
            onClick={() => onSelect(item.name === selected ? null : item.name)}
          >
            {item.share >= LABEL_MIN_SHARE && (
              <span className="langbar__label" aria-hidden="true">
                {item.name} {percent(item.share)}
              </span>
            )}
          </button>
        ))}
      </div>

      <ul className="legend">
        {shares.map((item) => (
          <li key={item.name}>
            <button
              type="button"
              className="legend__item"
              data-selected={item.name === selected}
              aria-pressed={item.name === selected}
              onClick={() => onSelect(item.name === selected ? null : item.name)}
            >
              <span className="legend__swatch" style={{ background: colorFor(item.name) }} />
              <span className="legend__name">{item.name}</span>
              <span className="legend__share">{percent(item.share)}</span>
            </button>
          </li>
        ))}
      </ul>

      <p className="langbar__note">
        {selected
          ? `${selected} を最もよく使うリポジトリだけを表示しています。もう一度押すと解除します。`
          : "リポジトリ 1 件を等しい重みとして数えています。押すとその言語を最もよく使うものだけに絞り込みます。"}
      </p>
    </div>
  );
}
