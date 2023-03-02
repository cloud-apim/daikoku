import {
  Active,
  defaultDropAnimationSideEffects, DndContext, DraggableSyntheticListeners, DragOverlay, DropAnimation, KeyboardSensor,
  PointerSensor, UniqueIdentifier, useDroppable, useSensor,
  useSensors
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable
} from '@dnd-kit/sortable';
import React, { createContext, PropsWithChildren, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

import { CSS } from '@dnd-kit/utilities';
import classNames from 'classnames';
import { nanoid } from 'nanoid';
import Trash  from 'react-feather/dist/icons/trash'


// *********************
// *** SORTABLE LIST ***
// *********************


interface BaseItem {
  id: UniqueIdentifier;
}

interface SortableListProps<T extends BaseItem> {
  items: Array<T>;
  onChange: (items: T[]) => void;
  renderItem: (item: T) => ReactNode;
  className?: string
  delete: (id: UniqueIdentifier) => void
}
export const SortableList = <T extends BaseItem>(props: SortableListProps<T>) => {
  const [active, setActive] = useState<Active | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [parent, setParent] = useState<UniqueIdentifier | null>(null);


  const activeItem = useMemo(
    () => props.items.find((item) => item.id === active?.id),
    [active, props.items]
  );
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  const droppableId = useMemo(() => nanoid(32), [])

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active }) => {
        setActive(active);
        setIsDragging(true)
      }}
      onDragEnd={({ active, over, ...other }) => {
        if (over && active.id !== over?.id) {
          const activeIndex = props.items.findIndex(({ id }) => id === active.id);
          const overIndex = props.items.findIndex(({ id }) => id === over.id);

          setParent(over ? over.id : null)

          if (over.id === droppableId) {
            props.delete(active.id)
          } else {
            props.onChange(arrayMove(props.items, activeIndex, overIndex));
          }

        }
        setActive(null);
        setIsDragging(false)
      }}
      onDragCancel={() => {
        setActive(null);
        setIsDragging(false)
      }}
    >
      <div className='d-flex flex-column'>
        <SortableContext items={props.items}>
          <ul className="sortable-list sorted-list" role="application">
            {props.items.map((item, idx) => (
              <React.Fragment key={item.id}>{props.renderItem(item)}</React.Fragment>
            ))}
          </ul>
        </SortableContext>
        <SortableOverlay>
          {activeItem ? props.renderItem(activeItem) : null}
        </SortableOverlay>
        <Droppable key={droppableId} id={droppableId} dragging={isDragging}/>
      </div>
    </DndContext>
  );

}


// ************************
// *** SORTABLE CONTEXT ***
// ************************

interface Context {
  attributes: Record<string, any>;
  listeners: DraggableSyntheticListeners;
  ref(node: HTMLElement | null): void;
}

const SortableItemContext = createContext<Context>({
  attributes: {},
  listeners: undefined,
  ref() { }
});

// *********************
// *** SORTABLE ITEM ***
// *********************

interface SortableItemProps {
  id: UniqueIdentifier;
  action?: ReactNode | undefined
}
export const SortableItem = (props: PropsWithChildren<SortableItemProps>) => {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition
  } = useSortable({ id: props.id });

  const context = useMemo(
    () => ({
      attributes,
      listeners,
      ref: setActivatorNodeRef
    }),
    [attributes, listeners, setActivatorNodeRef]
  );


  const style = {
    opacity: isDragging ? 0.4 : undefined,
    transform: CSS.Translate.toString(transform),
    transition
  };

  return (
    <SortableItemContext.Provider value={context}>
      <li className="sortable-item sorted-list__step" ref={setNodeRef} style={style}>
        <DraggableContent>
          {props.children}
        </DraggableContent>
        {props.action}
      </li>
    </SortableItemContext.Provider>
  );
}

export const FixedItem = (props: PropsWithChildren<SortableItemProps>) => {
  return (
    <li className="sortable-item fixed sorted-list__step">
      {props.children}
    </li>
  );
}


// ***************
// *** OVERLAY ***
// ***************

const dropAnimationConfig: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: "0.4"
      }
    }
  })
};

interface Props { }

export function SortableOverlay({ children }: PropsWithChildren<Props>) {
  return (
    <DragOverlay dropAnimation={dropAnimationConfig}>{children}</DragOverlay>
  );
}

// *************************
// *** DRAGGABLE CONTENT ***
// *************************


const DraggableContent = (props: PropsWithChildren<Props>) => {
  const { attributes, listeners, ref } = useContext(SortableItemContext);

  return (
    <div className="drag-handle" {...attributes} {...listeners} ref={ref}>
      {props.children}
    </div>
  );
}


// *************************
// *** DROPPABLE CONTENT ***
// *************************
interface DroppableProps {
  dragging: boolean;
  id: UniqueIdentifier;
}

const droppable = (
  <svg
    width="277px"
    height="67px"
    viewBox="0 0 277 67"
    version="1.1"
    xmlns="http://www.w3.org/2000/svg"
  >
    <g stroke="none" strokeWidth="1" fill="none" fillRule="evenodd">
      <path
        d="M12,0 L55,0 C61.627417,-1.21743675e-15 67,5.372583 67,12 L67,55 C67,61.627417 61.627417,67 55,67 L12,67 C5.372583,67 8.11624501e-16,61.627417 0,55 L0,12 C-8.11624501e-16,5.372583 5.372583,-2.33527693e-15 12,-3.55271368e-15 Z M47.2082502,44.0547945 L44.0871636,47.0285811 L51.6380737,54.5794638 L44.1788904,54.5794638 L44.1788904,58.739726 L58.739726,58.739726 L58.739726,44.1788476 L54.5794872,44.1788476 L54.5794872,51.6380263 L47.2082502,44.0547945 Z M19.3652148,44.0547945 L11.9939778,51.6380263 L11.9939778,44.1788476 L7.83373894,44.1788476 L7.83373894,58.739726 L22.3945746,58.739726 L22.3945746,54.5794638 L14.9353912,54.5794638 L22.4863014,47.0285811 L19.3652148,44.0547945 Z M19.3652148,22.4863014 L22.4863014,19.5125148 L14.9353912,11.9616321 L22.3945746,11.9616321 L22.3945746,7.80136986 L7.83373894,7.80136986 L7.83373894,22.3622483 L11.9939778,22.3622483 L11.9939778,14.9030696 L19.3652148,22.4863014 Z M47.2082502,22.4863014 L54.5794872,14.9030696 L54.5794872,22.3622483 L58.739726,22.3622483 L58.739726,7.80136986 L44.1788904,7.80136986 L44.1788904,11.9616321 L51.6380737,11.9616321 L44.0871636,19.5125148 L47.2082502,22.4863014 Z M88,33.7197746 C88,30.3498807 88.7678047,27.6659936 90.3034373,25.6680328 C91.8390698,23.670072 93.9395401,22.6711066 96.6049111,22.6711066 C98.7426198,22.6711066 100.508232,23.4569594 101.901802,25.0286885 L101.901802,14 L107.787237,14 L107.787237,44.6885246 L102.490346,44.6885246 L102.206221,42.3908811 C100.745003,44.1890459 98.8643882,45.0881148 96.5643219,45.0881148 C93.9801297,45.0881148 91.9067186,44.0858194 90.3440265,42.0811988 C88.7813343,40.0765781 88,37.2894646 88,33.7197746 Z M93.8651399,34.1393443 C93.8651399,36.1639445 94.2236742,37.7156708 94.9407538,38.7945697 C95.6578333,39.8734685 96.6996124,40.4129098 98.0661224,40.4129098 C99.8791159,40.4129098 101.157663,39.6603559 101.901802,38.1552254 L101.901802,29.6239754 C101.171193,28.1188449 99.9061753,27.366291 98.1067116,27.366291 C95.278983,27.366291 93.8651399,29.6239528 93.8651399,34.1393443 Z M125.184331,28.4851434 C124.386072,28.3785855 123.682533,28.3253074 123.073692,28.3253074 C120.854805,28.3253074 119.400373,29.0645418 118.710353,30.5430328 L118.710353,44.6885246 L112.845213,44.6885246 L112.845213,23.0706967 L118.385639,23.0706967 L118.547996,25.6480533 C119.725089,23.6634122 121.355405,22.6711066 123.438995,22.6711066 C124.088425,22.6711066 124.697257,22.7576836 125.265509,22.9308402 L125.184331,28.4851434 Z M126.873403,33.6798156 C126.873403,31.5353376 127.292821,29.6239838 128.131668,27.9456967 C128.970516,26.2674096 130.178033,24.9687546 131.754255,24.0496926 C133.330477,23.1306307 135.160355,22.6711066 137.243945,22.6711066 C140.206971,22.6711066 142.625387,23.5635157 144.499265,25.3483607 C146.373142,27.1332056 147.418304,29.5573617 147.634781,32.6209016 L147.67537,34.0993852 C147.67537,37.4160002 146.735063,40.0765781 144.85442,42.0811988 C142.973778,44.0858194 140.450507,45.0881148 137.284534,45.0881148 C134.11856,45.0881148 131.591907,44.0891493 129.7045,42.0911885 C127.817093,40.0932277 126.873403,37.3760418 126.873403,33.9395492 L126.873403,33.6798156 Z M132.738543,34.0993852 C132.738543,36.150625 133.130901,37.7190007 133.91563,38.8045594 C134.700358,39.8901181 135.823315,40.4328893 137.284534,40.4328893 C138.705163,40.4328893 139.81459,39.8967779 140.612848,38.8245389 C141.411107,37.7523 141.81023,36.0374093 141.81023,33.6798156 C141.81023,31.668535 141.411107,30.110149 140.612848,29.0046107 C139.81459,27.8990723 138.691633,27.3463115 137.243945,27.3463115 C135.809786,27.3463115 134.700358,27.8957425 133.91563,28.9946209 C133.130901,30.0934993 132.738543,31.7950704 132.738543,34.0993852 Z M171.566736,34.0794057 C171.566736,37.4093404 170.798932,40.0765781 169.263299,42.0811988 C167.727667,44.0858194 165.654256,45.0881148 163.043004,45.0881148 C160.824116,45.0881148 159.031444,44.328901 157.664934,42.8104508 L157.664934,53 L151.799795,53 L151.799795,23.0706967 L157.238748,23.0706967 L157.441694,25.1885246 C158.862323,23.5102375 160.715878,22.6711066 163.002415,22.6711066 C165.708375,22.6711066 167.812228,23.6567524 169.314036,25.6280738 C170.815844,27.5993951 171.566736,30.316581 171.566736,33.7797131 L171.566736,34.0794057 Z M165.701597,33.6598361 C165.701597,31.6485555 165.33968,30.0968292 164.615835,29.0046107 C163.891991,27.9123921 162.840065,27.366291 161.460025,27.366291 C159.619972,27.366291 158.354954,28.058907 157.664934,29.4441598 L157.664934,38.295082 C158.382014,39.720294 159.660561,40.4328893 161.500614,40.4328893 C164.301283,40.4328893 165.701597,38.1752275 165.701597,33.6598361 Z M195.478398,34.0794057 C195.478398,37.4093404 194.710593,40.0765781 193.17496,42.0811988 C191.639328,44.0858194 189.565917,45.0881148 186.954665,45.0881148 C184.735778,45.0881148 182.943106,44.328901 181.576596,42.8104508 L181.576596,53 L175.711456,53 L175.711456,23.0706967 L181.150409,23.0706967 L181.353355,25.1885246 C182.773984,23.5102375 184.627539,22.6711066 186.914076,22.6711066 C189.620036,22.6711066 191.723889,23.6567524 193.225697,25.6280738 C194.727505,27.5993951 195.478398,30.316581 195.478398,33.7797131 L195.478398,34.0794057 Z M189.613258,33.6598361 C189.613258,31.6485555 189.251341,30.0968292 188.527497,29.0046107 C187.803652,27.9123921 186.751726,27.366291 185.371686,27.366291 C183.531633,27.366291 182.266616,28.058907 181.576596,29.4441598 L181.576596,38.295082 C182.293675,39.720294 183.572222,40.4328893 185.412275,40.4328893 C188.212944,40.4328893 189.613258,38.1752275 189.613258,33.6598361 Z M212.347832,44.6885246 C212.077236,44.1690548 211.881057,43.5230571 211.759289,42.7505123 C210.33866,44.3089217 208.491869,45.0881148 206.218863,45.0881148 C204.067624,45.0881148 202.285099,44.475416 200.871235,43.25 C199.457371,42.024584 198.750449,40.4795175 198.750449,38.6147541 C198.750449,36.323759 199.612961,34.5655799 201.338011,33.3401639 C203.063061,32.114748 205.555889,31.4953894 208.816572,31.4820697 L211.515754,31.4820697 L211.515754,30.2433402 C211.515754,29.2443598 211.255309,28.4451874 210.734411,27.8457992 C210.213514,27.2464109 209.391591,26.9467213 208.268617,26.9467213 C207.280942,26.9467213 206.506372,27.1798132 205.944885,27.6460041 C205.383399,28.112195 205.102659,28.7515328 205.102659,29.5640369 L199.23752,29.5640369 C199.23752,28.3119814 199.629878,27.1531816 200.414606,26.0876025 C201.199335,25.0220234 202.308762,24.1862223 203.742921,23.5801742 C205.17708,22.9741261 206.787102,22.6711066 208.573036,22.6711066 C211.278997,22.6711066 213.426821,23.3404134 215.016572,24.6790471 C216.606324,26.0176809 217.401188,27.8990657 217.401188,30.3232582 L217.401188,39.6936475 C217.414718,41.7448873 217.705604,43.2966136 218.273856,44.348873 L218.273856,44.6885246 L212.347832,44.6885246 Z M207.497422,40.6726434 C208.36333,40.6726434 209.161576,40.48284 209.892185,40.1032275 C210.622795,39.7236149 211.163979,39.2141425 211.515754,38.5747951 L211.515754,34.8586066 L209.323937,34.8586066 C206.38797,34.8586066 204.825301,35.857572 204.635884,37.8555328 L204.615589,38.1951844 C204.615589,38.9144503 204.872651,39.5071698 205.386784,39.9733607 C205.900916,40.4395515 206.604455,40.6726434 207.497422,40.6726434 Z M242.205812,34.0794057 C242.205812,37.5425378 241.454919,40.2430743 239.953111,42.1810963 C238.451303,44.1191183 236.354215,45.0881148 233.661784,45.0881148 C231.280539,45.0881148 229.379631,44.1890459 227.959001,42.3908811 L227.695172,44.6885246 L222.418575,44.6885246 L222.418575,14 L228.283715,14 L228.283715,25.008709 C229.636695,23.4502996 231.415838,22.6711066 233.621195,22.6711066 C236.300096,22.6711066 238.400566,23.640103 239.922669,25.578125 C241.444772,27.516147 242.205812,30.2433226 242.205812,33.7597336 L242.205812,34.0794057 Z M236.340672,33.6598361 C236.340672,31.4753989 235.988902,29.8803841 235.285353,28.8747439 C234.581803,27.8691036 233.533259,27.366291 232.139689,27.366291 C230.272577,27.366291 228.987265,28.1188449 228.283715,29.6239754 L228.283715,38.1552254 C229.000795,39.6736756 230.299636,40.4328893 232.180279,40.4328893 C234.074451,40.4328893 235.319174,39.5138412 235.914485,37.6757172 C236.198611,36.7966145 236.340672,35.4580008 236.340672,33.6598361 Z M252.52009,44.6885246 L246.634655,44.6885246 L246.634655,14 L252.52009,14 L252.52009,44.6885246 Z M267.968902,45.0881148 C264.748809,45.0881148 262.12745,44.1157884 260.104744,42.1711066 C258.082039,40.2264247 257.070701,37.6357744 257.070701,34.3990779 L257.070701,33.8396516 C257.070701,31.6685342 257.496884,29.7272114 258.349261,28.015625 C259.201639,26.3040386 260.409155,24.9854042 261.971848,24.0596824 C263.53454,23.1339605 265.317064,22.6711066 267.319475,22.6711066 C270.323091,22.6711066 272.687389,23.6034743 274.412438,25.4682377 C276.137488,27.3330011 277,29.9769296 277,33.4001025 L277,35.7576844 L263.017019,35.7576844 C263.206437,37.1695767 263.778062,38.3017375 264.731913,39.1542008 C265.685764,40.0066641 266.893281,40.4328893 268.3545,40.4328893 C270.613977,40.4328893 272.379589,39.6270572 273.651391,38.0153689 L276.533224,41.1921107 C275.653787,42.4175266 274.463182,43.3732035 272.961374,44.0591701 C271.459566,44.7451366 269.795426,45.0881148 267.968902,45.0881148 Z M267.29918,27.3463115 C266.135617,27.3463115 265.191928,27.7325781 264.468084,28.505123 C263.744239,29.2776678 263.28085,30.3831895 263.077903,31.8217213 L271.236333,31.8217213 L271.236333,31.3621926 C271.209274,30.0834977 270.857504,29.0945219 270.181014,28.3952357 C269.504524,27.6959494 268.543922,27.3463115 267.29918,27.3463115 Z"
        fill="#7F8C96"
      ></path>
    </g>
  </svg>
);

export function Droppable(props: DroppableProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: props.id,
  });

  return (
    <div
      ref={setNodeRef}
      className={classNames(
        'droppable', {
        over: isOver,
        dragging: props.dragging
      }
      )}
      aria-label="Droppable region"
    >
      <Trash />
    </div>
  );
}