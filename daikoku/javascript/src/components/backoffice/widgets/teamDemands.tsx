
import { getApolloContext, gql } from '@apollo/client';
import { useQuery } from '@tanstack/react-query';
import { useContext } from 'react';
import { useSelector } from 'react-redux';

import { I18nContext } from '../../../core';
import * as Services from '../../../services';
import { IState, ISubscriptionDemand, ITeamSimple, IUserSimple } from '../../../types';
import { formatPlanType } from '../../utils';
import { FeedbackButton } from '../../utils/FeedbackButton';
import { Widget } from './widget';
import { ModalContext } from '../../../contexts';
import { Option } from '../../utils';

type LastDemandsProps = {
  team: ITeamSimple
}
export const LastDemands = (props: LastDemandsProps) => {
  const GET_TEAM_LAST_DEMANDS = gql`
    query GetTeamLastDemands($teamId: String!, $limit: Int, $offset: Int) {
      teamSubscriptionDemands(teamId: $teamId , limit: $limit, offset: $offset) {
        total
        subscriptionDemands {
          id
          api {
            name
          }
          plan {
            customName
            type
          }
          steps {
            id
            state
            step {
              name
            }
          }
          state
          team {
            name
          }
          from {
            name
          }
          date
        }
      }
    }
  `
  const connectedUser = useSelector<IState, IUserSimple>((s) => s.context.connectedUser);
  const { translate } = useContext(I18nContext);
  const { confirm } = useContext(ModalContext);
  const { client } = useContext(getApolloContext());
  const { isLoading, isError, data } = useQuery({
    queryKey: ["widget", "widget_team_last_demands"],
    queryFn: () => client?.query({
      query: GET_TEAM_LAST_DEMANDS,
      variables: { teamId: props.team._id, offset: 0, limit: 5 }
    })
  })
  const isAdmin = !!props.team.users.find(u => u.userId === connectedUser._id && u.teamPermission === 'Administrator')

  const handleCheckout = (demandId: string) => {
    return Services.rerunProcess(props.team._id, demandId)
      .then(r => {
        window.location.href = r.checkoutUrl
      })
  }

  const cancelDemand = (demandId: string) => {
    confirm({
      title: translate('demand.delete.modal.title'),
      message: translate('demand.delete.modal.message')
    })
      .then(() => Services.cancelProcess(props.team._id, demandId))
  }

  return (
    <>
      <Widget isLoading={isLoading} isError={isError} size="small" title={translate("widget.demands.title")}>
        <div className='d-flex flex-column gap-1'>
          {data?.data && data.data.teamSubscriptionDemands.total === 0 && <span className='widget-list-default-item'>{translate('widget.demands.no.demands')}</span>}
          {data?.data && data.data.teamSubscriptionDemands.total > 0 && data.data.teamSubscriptionDemands.subscriptionDemands.map((d) => {
            const checkout = d.state === 'inProgress' && d.steps.find(s => s.state === 'inProgress').step.name === 'payment'

            return (
              <div className='d-flex flex-column justify-content-between align-items-center widget-list-item'>
                <div className='item-title'>{`${d.api.name} / ${d.plan.customName || formatPlanType(d.plan.type, translate)}`}</div>
                <div className='d-flex justify-content-between w-100 my-2'>
                  {checkout && <FeedbackButton
                    type="primary"
                    className="ms-1 btn-sm"
                    onPress={() => handleCheckout(d.id)}
                    onSuccess={() => console.debug("success")}
                    feedbackTimeout={100}
                    disabled={false}
                  >Checkout</FeedbackButton>
                  }
                  {!checkout && <span className='badge bg-secondary my-2'>{translate({ key: 'widget.demands.state', replacements: [translate(d.state)] })}</span>}
                  {isAdmin && <button className='btn btn-sm btn-outline-danger ms-1' onClick={() => cancelDemand(d.id)}>{translate('Cancel')}</button>}
                </div>
              </div>
            )
          })}
        </div>
      </Widget>
    </>
  )
}