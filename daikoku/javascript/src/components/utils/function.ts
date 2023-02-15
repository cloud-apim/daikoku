import { IApi, IBaseUsagePlan, IFastPlan, isValidationStepEmail, isValidationStepTeamAdmin, IUsagePlan, IValidationStep } from "../../types";

export function partition(array: any, isValid: any) {
  return array.reduce(
    ([pass, fail]: Array<any>, elem: any) => {
      return isValid(elem) ? [[...pass, elem], fail] : [pass, [...fail, elem]];
    },
    [[], []]
  );
}

export const randomColor = () => {
  const maxValue = 0xffffff;
  const random = Math.random() * maxValue;

  const hexCode = Math.floor(random).toString(16).padStart(6, '0');
  return `#${hexCode}`;
};

export const getColorByBgColor = (bgColor: string) => {
  return parseInt(bgColor.replace('#', ''), 16) > 0xffffff / 2 ? '#000' : '#fff';
};

export const isSubscriptionProcessIsAutomatic = (plan: IBaseUsagePlan): boolean => {
  return plan.subscriptionProcess.steps.every(step => !isValidationStepEmail(step) && !isValidationStepTeamAdmin(step))
}

export const isPublish = (api: IApi): boolean => {
  return api.state === 'published' || api.state === 'deprecated'
}