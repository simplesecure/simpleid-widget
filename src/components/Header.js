import React from 'reactn';
import Nav from 'react-bootstrap/Nav';
import Navbar from 'react-bootstrap/Navbar';
import Image from 'react-bootstrap/Image';
import { closeWidget } from '../actions/postMessage';

export default class Header extends React.Component {
  render() {
    return (
      <Navbar className="header-nav" bg="dark" expand="lg">
        <Navbar.Brand className="brand-div"><Image className="sid-logo" src={require('../assets/img/favicon.png')} alt="SimpleID favicon" roundedCircle /></Navbar.Brand>        
        <Nav>
          <span onClick={() => closeWidget()} className="close-icon">X</span>
        </Nav>
      </Navbar>
    )
  }
}