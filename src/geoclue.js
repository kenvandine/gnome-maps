/* -*- Mode: JS2; indent-tabs-mode: nil; js2-basic-offset: 4 -*- */
/* vim: set et ts=4 sw=4: */
/*
 * Copyright (c) 2011, 2012, 2013 Red Hat, Inc.
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
 * with GNOME Maps; if not, see <http://www.gnu.org/licenses/>.
 *
 * Author: Zeeshan Ali (Khattak) <zeeshanak@gnome.org>
 */

const GObject = imports.gi.GObject;
const GClue = imports.gi.Geoclue;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Mainloop = imports.mainloop;

const Place = imports.place;
const Location = imports.location;
const Settings = imports.settings;
const Utils = imports.utils;

const State = {
    INITIAL: 0,
    ON: 1,
    DENIED: 2,
    FAILED: 3
};

const Geoclue = new Lang.Class({
    Name: 'Geoclue',
    Extends: GObject.Object,
    Signals: {
        'location-changed': { }
    },
    Properties: {
        'state': GObject.ParamSpec.int('state',
                                       '',
                                       '',
                                       GObject.ParamFlags.READABLE |
                                       GObject.ParamFlags.WRITABLE,
                                       State.INITIAL,
                                       State.FAILED,
                                       State.INITIAL)
    },

    set state(s) {
        this._state = s;
        this.notify('state');
    },

    get state() {
        return this._state;
    },

    _init: function() {
        this.parent();
        this.place = null;
        this._state = State.INITIAL;

        this.start(null);
    },

    start: function(callback) {
        let id = 'org.gnome.Maps';
        let level = GClue.AccuracyLevel.EXACT;

        GClue.Simple.new(id, level, null, (function(object, result) {
            try {
                this._simple = GClue.Simple.new_finish(result);
            }
            catch (e) {
                Utils.debug("GeoClue2 service: " + e.message);
                if (e.matches(Gio.DBusError, Gio.DBusError.ACCESS_DENIED))
                    this.state = State.DENIED;
                else
                    this.state = State.FAILED;
                if (callback)
                    callback(false);
                return;
            }

            this._simple.connect('notify::location',
                           this._onLocationNotify.bind(this));
            this._simple.client.connect('notify::active', (function() {
                this.state = this._simple.client.active ? State.ON : State.DENIED;
            }).bind(this));

            this.state = State.ON;
            this._onLocationNotify(this._simple);
            if (callback)
                callback(true);
        }).bind(this));
    },

    _onLocationNotify: function(simple) {
        let geoclueLocation = simple.get_location();
        let location = new Location.Location({
            latitude: geoclueLocation.latitude,
            longitude: geoclueLocation.longitude,
            accuracy: geoclueLocation.accuracy,
            heading: geoclueLocation.heading,
            description: geoclueLocation.description
        });
        this._updateLocation(location);
    },

    _updateLocation: function(location) {
        if (!this.place)
            this.place = new Place.Place({ name: _("Current location") });

        this.place.location = location;
        this.emit('location-changed');
        Utils.debug("Updated location: " + location.description);
    }
});
