import React, { useContext, useEffect, useState } from 'react';
import { Link, useMatch } from 'react-router-dom';
import moment from 'moment';
import { useSelector } from 'react-redux';

import * as Services from '../../../services';
import { OtoroshiStatsVizualization, Spinner } from '../../utils';
import { I18nContext } from '../../../core';

export const TeamPlanConsumption = ({ apiGroup }) => {
  const { currentTeam } = useSelector(state => state.context);

  const { translateMethod } = useContext(I18nContext);
  const urlMatching = !!apiGroup ? '/:teamId/settings/apigroups/:apiId/stats/plan/:planId' : '/:teamId/settings/apis/:apiId/:version/stats/plan/:planId'
  const match = useMatch(urlMatching)

  const [teams, setTeams] = useState([]);

  const mappers = [
    {
      type: 'LineChart',
      label: (data) => {
        const totalHits = data.reduce((acc, cons) => acc + cons.hits, 0);
        return translateMethod('data.in.plus.hits', false, `Data In (${totalHits})`, totalHits);
      },
      title: translateMethod('Data In'),
      formatter: (data) =>
        data.reduce((acc, item) => {
          const date = moment(item.to).format('DD MMM.');
          const value = acc.find((a) => a.date === date) || { count: 0 };
          return [...acc.filter((a) => a.date !== date), { date, count: value.count + item.hits }];
        }, []),
      xAxis: 'date',
      yAxis: 'count',
    },
    {
      type: 'RoundChart',
      label: translateMethod('Hits by apikey'),
      title: translateMethod('Hits by apikey'),
      formatter: (data) =>
        data.reduce((acc, item) => {
          const value = acc.find((a) => a.name === item.clientId) || { count: 0 };

          const team = teams.find((t) => t._id === item.team);
          const name = team.name;

          return [
            ...acc.filter((a) => a.name !== item.clientId),
            { clientId: item.clientId, name, count: value.count + item.hits },
          ];
        }, []),
      dataKey: 'count',
    },
    {
      type: 'Global',
      label: translateMethod('Global informations'),
      formatter: (data) => sumGlobalInformations(data),
    },
  ];

  const getPlanInformation = () => {
    return Services.teamApi(currentTeam._id, match.params.apiId, match.params.versionId)
      .then((api) => {
        if (api.error) {
          return null;
        }
        return {
          api,
          plan: api.possibleUsagePlans.find((pp) => pp._id === match.params.planId),
        };
      });
  };

  const sumGlobalInformations = (data) => {
    const globalInformations = data.map((d) => d.globalInformations);

    const value = globalInformations.reduce((acc, item) => {
      Object.keys(item).forEach((key) => (acc[key] = (acc[key] || 0) + item[key]));
      return acc;
    }, {});

    const howManyDuration = globalInformations.filter((d) => !!d.avgDuration).length;
    const howManyOverhead = globalInformations.filter((d) => !!d.avgDuration).length;

    return {
      ...value,
      avgDuration: value.avgDuration / howManyDuration,
      avgOverhead: value.avgOverhead / howManyOverhead,
    };
  };

  useEffect(() => {
    Services.teams()
      .then(setTeams);

    document.title = `${currentTeam.name} - ${translateMethod('Plan consumption')}`;
  }, []);

  return (
    <div>
      <div className="row">
        <div className="col">
          <h1>Api Consumption</h1>
          <PlanInformations fetchData={() => getPlanInformation()} />
        </div>
      </div>
      <OtoroshiStatsVizualization
        sync={() => Services.syncApiConsumption(params.apiId, currentTeam._id)}
        fetchData={(from, to) => {
          console.debug({match, currentTeam, from, to})
          return Services.apiConsumption(
            match.params.apiId,
            match.params.planId,
            currentTeam._id,
            from.valueOf(),
            to.valueOf()
          )
        }
        }
        mappers={mappers}
      />
    </div>
  );
}

const PlanInformations = (props) => {
  const [loading, setLoading] = useState(true);
  const [informations, setInformations] = useState();

  useEffect(() => {
    props.fetchData()
      .then((informations) => {
        setInformations(informations);
        setLoading(false);
      });
  }, []);

  if (loading) return <Spinner width="50" height="50" />;

  if (!informations) {
    return null;
  }

  return (
    <h3>
      {informations.api.name} - {informations.plan.customName || informations.plan.type}
    </h3>
  );
}
