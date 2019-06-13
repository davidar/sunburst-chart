import { select as d3Select, event as d3Event } from 'd3-selection';
import { scaleLinear, scaleSqrt } from 'd3-scale';
import { hierarchy as d3Hierarchy, partition as d3Partition } from 'd3-hierarchy';
import { arc as d3Arc } from 'd3-shape';
import { path as d3Path } from 'd3-path';
import { interpolate as d3Interpolate } from 'd3-interpolate';
import { transition as d3Transition } from 'd3-transition';
import Kapsule from 'kapsule';
import accessorFn from 'accessor-fn';

import './sunburst.css';

const TRANSITION_DURATION = 750;
const CHAR_PX = 6;

export default Kapsule({

  props: {
    width: { default: window.innerWidth },
    height: { default: window.innerHeight },
    data: { onChange: function() { this._parseData(); }},
    children: { default: 'children', onChange: function() { this._parseData(); }},
    sort: { onChange: function() { this._parseData(); }},
    label: { default: d => d.name },
    size: {
      default: 'value',
      onChange: function() { this._parseData(); }
    },
    color: { default: d => 'lightgrey' },
    minSliceAngle: { default: .2 },
    showLabels: { default: true },
    tooltipContent: { default: d => '', triggerUpdate: false },
    focusOnNode: {
      onChange: function(d, state) {
        if (d && state.initialised) {
          moveStackToFront(d.__dataNode);
        }

        function moveStackToFront(elD) {
          state.svg.selectAll('.slice').filter(d => d === elD)
            .each(function(d) {
              this.parentNode.appendChild(this);
              if (d.parent) { moveStackToFront(d.parent); }
            })
        }
      }
    },
    onNodeClick: { triggerUpdate: false }
  },

  methods: {
    _parseData: function(state) {
      if (state.data) {
        const hierData = d3Hierarchy(state.data, accessorFn(state.children))
          .sum(accessorFn(state.size));

        if (state.sort) {
          hierData.sort(state.sort);
        }

        d3Partition().padding(0)(hierData);

        hierData.descendants().forEach((d, i) => {
          d.id = i; // Mark each node with a unique ID
          d.data.__dataNode = d; // Dual-link data nodes
        });

        state.layoutData = hierData.descendants();
      }
    }
  },

  init: function(domNode, state) {
    state.chartId = Math.round(Math.random() * 1e12); // Unique ID for DOM elems

    state.radiusScale = scaleSqrt();
    state.angleScale = scaleLinear()
      .domain([0, 10]) // For initial build-in animation
      .range([0, 2 * Math.PI])
      .clamp(true);

    state.arc = d3Arc()
      .startAngle(d => state.angleScale(d.x0))
      .endAngle(d => state.angleScale(d.x1))
      .innerRadius(d => Math.max(0, state.radiusScale(d.y0)))
      .outerRadius(d => Math.max(0, state.radiusScale(d.y1)));

    const el = d3Select(domNode)
      .append('div').attr('class', 'sunburst-viz');

    state.svg = el.append('svg');
    state.canvas = state.svg.append('g');

    // tooltips
    state.tooltip = d3Select('body')
      .append('div')
          .attr('class', 'sunburst-tooltip');

    // tooltip cleanup on unmount
    domNode.addEventListener ('DOMNodeRemoved', function(e) {
      if (e.target === this) { state.tooltip.remove(); }
    });

    state.canvas.on('mousemove', () => {
      state.tooltip
        .style('left', d3Event.pageX + 'px')
        .style('top', d3Event.pageY + 'px')
        .style('transform', `translate(-${d3Event.pageX / state.width * 100}%, 21px)`); // adjust horizontal position to not exceed canvas boundaries
    });

    // Reset focus by clicking on canvas
    state.svg.on('click', () => this.focusOnNode(null));
  },

  update: function(state) {
    const maxRadius = (Math.min(state.width, state.height) / 2);
    state.radiusScale.range([maxRadius * .1, maxRadius]);

    state.svg
      .style('width', state.width + 'px')
      .style('height', state.height + 'px')
      .attr('viewBox', `${-state.width/2} ${-state.height/2} ${state.width} ${state.height}`);

    if (!state.layoutData) return;

    const focusD = (state.focusOnNode && state.focusOnNode.__dataNode) || { x0: 0, x1: 1, y0: 0, y1: 1 };

    const slice = state.canvas.selectAll('.slice')
      .data(
        state.layoutData
          .filter(d => // Show only slices with a large enough angle
            d.x1 >= focusD.x0
            && d.x0 <= focusD.x1
            && (d.x1-d.x0)/(focusD.x1-focusD.x0) > state.minSliceAngle/360
          ),
        d => d.id
      );

    const nameOf = accessorFn(state.label);
    const colorOf = accessorFn(state.color);
    const transition = d3Transition().duration(TRANSITION_DURATION);

    // Apply zoom
    state.svg.transition(transition)
      .tween('scale', () => {
        const xd = d3Interpolate(state.angleScale.domain(), [focusD.x0, focusD.x1]);
        const yd = d3Interpolate(state.radiusScale.domain(), [focusD.y0, 1]);
        return t => {
          state.angleScale.domain(xd(t));
          state.radiusScale.domain(yd(t));
        };
      });

    // Exiting
    const oldSlice = slice.exit().transition(transition).style('opacity', 0).remove();
    oldSlice.select('path.main-arc').attrTween('d', d => () => state.arc(d));
    oldSlice.select('path.hidden-arc').attrTween('d', d => () => middleArcLine(d));

    // Entering
    const newSlice = slice.enter().append('g')
      .attr('class', 'slice')
      .style('opacity', 0)
      .on('click', d => {
        d3Event.stopPropagation();
        (state.onNodeClick || this.focusOnNode)(d.data);
      })
      .on('mouseover', d => {
        state.tooltip.style('display', 'inline');
        state.tooltip.html(`<div class="tooltip-title">${
          getNodeStack(d).map(d => nameOf(d.data)).join(' > ')
        }</div>${state.tooltipContent(d.data, d)}`);
      })
      .on('mouseout', () => { state.tooltip.style('display', 'none'); });

    newSlice.append('path')
      .attr('class', 'main-arc')
      .style('fill', d => colorOf(d.data, d.parent));

    newSlice.append('path')
      .attr('class', 'hidden-arc')
      .attr('id', d => `hidden-arc-${state.chartId}-${d.id}`);

    const label = newSlice.append('text')
        .attr('class', 'path-label');

    // Add white contour
    label.append('textPath')
      .attr('class', 'text-contour')
      .attr('startOffset','50%')
      .attr('xlink:href', d => `#hidden-arc-${state.chartId}-${d.id}` );

    label.append('textPath')
      .attr('class', 'text-stroke')
      .attr('startOffset','50%')
      .attr('xlink:href', d => `#hidden-arc-${state.chartId}-${d.id}` );

    // Entering + Updating
    const allSlices = slice.merge(newSlice);

    allSlices.style('opacity', 1);

    allSlices.select('path.main-arc').transition(transition)
      .attrTween('d', d => () => state.arc(d))
      .style('fill', d => colorOf(d.data, d.parent));

    allSlices.select('path.hidden-arc').transition(transition)
      .attrTween('d', d => () => middleArcLine(d));

    allSlices.select('.path-label')
      .transition(transition)
        .styleTween('display', d => () => state.showLabels && textFits(d) ? null : 'none');

    // Ensure propagation of data to children
    allSlices.selectAll('text.path-label').select('textPath.text-contour');
    allSlices.selectAll('text.path-label').select('textPath.text-stroke');

    allSlices.selectAll('text.path-label').selectAll('textPath')
      .text(d => nameOf(d.data));

    //

    function middleArcLine(d) {
      const halfPi = Math.PI/2;
      const angles = [state.angleScale(d.x0) - halfPi, state.angleScale(d.x1) - halfPi];
      const r = Math.max(0, (state.radiusScale(d.y0) + state.radiusScale(d.y1)) / 2);

      if (!r || !(angles[1] - angles[0])) return '';

      const middleAngle = (angles[1] + angles[0]) / 2;
      const invertDirection = middleAngle > 0 && middleAngle < Math.PI; // On lower quadrants write text ccw
      if (invertDirection) { angles.reverse(); }

      const path = d3Path();
      path.arc(0, 0, r, angles[0], angles[1], invertDirection);
      return path.toString();
    }

    function textFits(d) {
      const deltaAngle = state.angleScale(d.x1) - state.angleScale(d.x0);
      const r = Math.max(0, (state.radiusScale(d.y0) + state.radiusScale(d.y1)) / 2);
      const perimeter = r * deltaAngle;
      return nameOf(d.data).toString().length * CHAR_PX < perimeter;
    }

    function getNodeStack(d) {
      const stack = [];
      let curNode = d;
      while (curNode) {
        stack.unshift(curNode);
        curNode = curNode.parent;
      }
      return stack;
    }
  }
});
