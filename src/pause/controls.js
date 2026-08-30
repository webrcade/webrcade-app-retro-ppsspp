import React from 'react';

import { ControlsTab } from '@webrcade/app-common';

export class GamepadControlsTab extends ControlsTab {
  render() {
    return (
      <>
        {this.renderControl('start', 'Start')}
        {this.renderControl('dpad', 'Move')}
        {this.renderControl('lanalog', 'Move')}
        {this.renderControl('x', 'Button A')}
        {this.renderControl('a', 'Button B')}
        {this.renderControl('b', 'Button C')}
        {this.renderControl('y', 'Button X')}
        {this.renderControl('lbump', 'Button Y')}
        {this.renderControl('rbump', 'Button Z')}
        {this.renderControl('ltrig', 'Left Bumper')}
        {this.renderControl('rtrig', 'Right Bumper')}
      </>
    );
  }
}

export class KeyboardControlsTab extends ControlsTab {
  render() {
    return (
      <>
        {this.renderKey('Enter', 'Start')}
        {this.renderKey('ArrowUp', 'Up')}
        {this.renderKey('ArrowDown', 'Down')}
        {this.renderKey('ArrowLeft', 'Left')}
        {this.renderKey('ArrowRight', 'Right')}
        {this.renderKey('KeyZ', 'Button A')}
        {this.renderKey('KeyX', 'Button B')}
        {this.renderKey('KeyC', 'Button C')}
        {this.renderKey('KeyA', 'Button X')}
        {this.renderKey('KeyS', 'Button Y')}
        {this.renderKey('KeyD', 'Button Z')}
        {this.renderKey('KeyQ', 'Left Bumper')}
        {this.renderKey('KeyE', 'Right Bumper')}
      </>
    );
  }
}
