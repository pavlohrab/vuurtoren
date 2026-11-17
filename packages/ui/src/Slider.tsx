import * as RSlider from "@radix-ui/react-slider";

export interface SliderProps {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  "aria-label": string;
}

/** Single-thumb slider (e.g. density dial). */
export function Slider({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  "aria-label": ariaLabel,
}: SliderProps) {
  return (
    <RSlider.Root
      className="k-slider"
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={(v) => onValueChange(v[0] ?? min)}
    >
      <RSlider.Track className="k-slider-track">
        <RSlider.Range className="k-slider-range" />
      </RSlider.Track>
      <RSlider.Thumb className="k-slider-thumb" aria-label={ariaLabel} />
    </RSlider.Root>
  );
}
