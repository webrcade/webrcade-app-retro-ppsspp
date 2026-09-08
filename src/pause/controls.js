import React from 'react';

import { ControlsTab } from '@webrcade/app-common';

export class GamepadControlsTab extends ControlsTab {
  render() {
    return (
      <>
        {this.renderControl('start', 'Start')}
        {this.renderControl('select', 'Select')}
        {this.renderControl('dpad', 'D-pad')}
        {this.renderControl('lanalog', 'Left analog')}
        {this.renderControl('ranalog', 'Mapped to face buttons')}
        {this.renderControl('b', 'Circle')}
        {this.renderControl('a', 'Cross')}
        {this.renderControl('y', 'Triangle')}
        {this.renderControl('x', 'Square')}
        {this.renderControl('lbump', 'L')}
        {this.renderControl('rbump', 'R')}
      </>
    );
  }
}

export class KeyboardControlsTab extends ControlsTab {
  render() {
    return (
      <>
        {this.renderKey('Enter', 'Start')}
        {this.renderKey('ShiftRight', 'Select')}
        {this.renderKey('ArrowUp', 'Analog stick (Up)')}
        {this.renderKey('ArrowDown', 'Analog stick (Down)')}
        {this.renderKey('ArrowLeft', 'Analog stick (Left)')}
        {this.renderKey('ArrowRight', 'Analog stick (Right)')}
        {this.renderKey('KeyI', 'D-pad (Up)')}
        {this.renderKey('KeyK', 'D-pad (Down)')}
        {this.renderKey('KeyJ', 'D-pad (Left)')}
        {this.renderKey('KeyL', 'D-pad (Right)')}
        {this.renderKey('KeyX', 'Circle')}
        {this.renderKey('KeyZ', 'Cross')}
        {this.renderKey('KeyS', 'Triangle')}
        {this.renderKey('KeyA', 'Square')}
        {this.renderKey('KeyQ', 'L')}
        {this.renderKey('KeyW', 'R')}
      </>
    );
  }
}
