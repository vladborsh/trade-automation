import { GeneralTimeIntervals } from "../../types/enums";

export function isValidIntervalType(action: any): action is GeneralTimeIntervals {
  return Object.values(GeneralTimeIntervals).includes(action);
}
