export type EvidenceLabel = "real" | "simulated" | "estimated";
export type Evidence = { kind: string; messageKey: string; values?: Record<string, string | number> };
export type Conclusion<T> = {
  kind: "conclusion";
  label: EvidenceLabel;
  data: T;
  evidence: [Evidence, ...Evidence[]];
};
export type NotSimulated = { kind: "not_simulated"; reasonKey: string };
export type Outcome<T> = Conclusion<T> | NotSimulated;
