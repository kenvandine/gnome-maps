/* -*- Mode: JS2; indent-tabs-mode: nil; js2-basic-offset: 4 -*- */
/* vim: set et ts=4 sw=4: */
/*
 * Copyright (c) 2013 Mattias Bengtsson.
 *
 * GNOME Maps is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version.
 *
 * GNOME Maps is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
 * for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with GNOME Maps; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 * Author: Mattias Bengtsson <mattias.jc.bengtsson@gmail.com>
 */

const Champlain = imports.gi.Champlain;
const GLib = imports.gi.GLib;
const Soup = imports.gi.Soup;

const Lang = imports.lang;
const _ = imports.gettext.gettext;

const Application = imports.application;
const Config = imports.config;
const EPAF = imports.epaf;
const HTTP = imports.http;
const Route = imports.route;
const RouteQuery = imports.routeQuery;
const Utils = imports.utils;

const GraphHopper = new Lang.Class({
    Name: 'GraphHopper',

    get query() {
        return this._query;
    },

    get route() {
        return this._route;
    },

    _init: function() {
        this._session = new Soup.Session({ user_agent : Config.USER_AGENT });
        this._key     = "VCIHrHj0pDKb8INLpT4s5hVadNmJ1Q3vi0J4nJYP";
        this._baseURL = "http://graphhopper.com/api/1/route?";
        this._locale  = GLib.get_language_names()[0];
        this._route   = new Route.Route();
        this._query   = new RouteQuery.RouteQuery();

        this.query.connect('updated', (function() {
            if (this.query.from && this.query.to) {
                this.fetchRoute([this.query.from.location,
                                 this.query.to.location],
                                this.query.transportation);
            } else
                this.route.reset();
        }).bind(this));

        this.parent();
    },

    fetchRoute: function(viaPoints, transportationType) {
        let url = this._buildURL(viaPoints, transportationType);
        let msg = Soup.Message.new('GET', url);
        this._session.queue_message(msg, (function(session, message) {
            try {
                let result = this._parseMessage(message);
                if (!result) {
                    Application.notificationManager.showMessage(_("No route found."));
                } else {
                    let route = this._createRoute(result.paths[0]);
                    this.route.update(route);
                }
            } catch(e) {
                Application.notificationManager.showMessage(_("Route request failed."));
                log(e);
            }
        }).bind(this));
    },

    _buildURL: function(viaPoints, transportation) {
        let points = viaPoints.map(function({ latitude, longitude }) {
            return [latitude, longitude].join(',');
        });
        let vehicle = RouteQuery.Transportation.toString(transportation);
        let query = new HTTP.Query({ type:    'json',
                                     key:     this._key,
                                     vehicle: vehicle,
                                     locale:  this._locale,
                                     point:   points,
                                     debug:   Utils.debugEnabled
                                   });
        let url = this._baseURL + query.toString();
        Utils.debug("Sending route request to: " + url);
        return url;
    },

    _parseMessage: function({ status_code, response_body, uri }) {
        if (status_code === 500) {
            log("Internal server error.\n"
                + "This is most likely a bug in GraphHopper");
            log("Please file a bug at "
                + "https://github.com/graphhopper/graphhopper/issues\n"
                + "with the the following Graphopper request URL included:\n");
            log(uri.to_string(false));
        }
        if (status_code !== 200)
            return null;

        let result = JSON.parse(response_body.data);

        if (!Array.isArray(result.paths)) {
            Utils.debug("No route found");
            if (result.info && Array.isArray(result.info.errors)) {
                result.info.errors.forEach(function({ message, details }) {
                    Utils.debug("Message: " + message);
                    Utils.debug("Details: " + details);
                });
            }
            return null;
        }

        return result;
    },

    _createRoute: function(route) {
        let path       = EPAF.decode(route.points);
        let turnPoints = this._createTurnPoints(path, route.instructions);
        let bbox       = new Champlain.BoundingBox();

        // GH does lonlat-order and Champlain latlon-order
        bbox.extend(route.bbox[1], route.bbox[0]);
        bbox.extend(route.bbox[3], route.bbox[2]);

        return { path:       path,
                 turnPoints: turnPoints,
                 distance:   route.distance,
                 time:       route.time,
                 bbox:       bbox };
    },

    _createTurnPoints: function(path, instructions) {
        let startPoint = new Route.TurnPoint({ coordinate:  path[0],
                                               type:        Route.TurnPointType.START,
                                               distance:    0,
                                               instruction: _("Start!"),
                                               time:        0
                                             });
        let rest = instructions.map(this._createTurnPoint.bind(this, path));
        return [startPoint].concat(rest);
    },

    _createTurnPoint: function(path, { text, distance, time, interval, sign }) {
        return new Route.TurnPoint({ coordinate:  path[interval[0]],
                                     type:        this._createTurnPointType(sign),
                                     distance:    distance,
                                     instruction: text,
                                     time:        time });
    },

    _createTurnPointType: function(sign) {
        let type = sign + 3;
        let min  = Route.TurnPointType.SHARP_LEFT;
        let max  = Route.TurnPointType.VIA;
        if (min <= type && type <= max)
            return type;
        else
            return undefined;
    }
});