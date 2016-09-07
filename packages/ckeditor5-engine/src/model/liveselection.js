/**
 * @license Copyright (c) 2003-2016, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md.
 */

import LiveRange from './liverange.js';
import Range from './range.js';
import Position from './position.js';
import Text from './text.js';
import TextProxy from './textproxy.js';
import toMap from '../../utils/tomap.js';

import Selection from './selection.js';

const storePrefix = 'selection:';

/**
 * `LiveSelection` is a type of {@link engine.model.Selection selection} that listens to changes on a
 * {@link engine.model.Document document} and has it ranges updated accordingly. Internal implementation of this
 * mechanism bases on {@link engine.model.LiveRange live ranges}.
 *
 * Differences between {@link engine.model.Selection} and `LiveSelection` are two:
 * * there is always a range in `LiveSelection` - even if no ranges were added there is a
 * {@link engine.model.LiveSelection#_getDefaultRange "default range"} present in the selection,
 * * ranges added to this selection updates automatically when the document changes.
 *
 * Since `LiveSelection` uses {@link engine.model.LiveRange live ranges} and is updated when {@link engine.model.Document document}
 * changes, it cannot be set on {@link engine.model.Node nodes} that are inside {@link engine.model.DocumentFragment document fragment}.
 * If you need to represent a selection in document fragment, use {@link engine.model.Selection "normal" selection} instead.
 *
 * @memberOf engine.model
 */
export default class LiveSelection extends Selection {
	/**
	 * Creates an empty live selection for given {@link engine.model.Document}.
	 *
	 * @param {engine.model.Document} document Document which owns this selection.
	 */
	constructor( document ) {
		super();

		/**
		 * Document which owns this selection.
		 *
		 * @private
		 * @member {engine.model.Document} engine.model.Selection#_document
		 */
		this._document = document;
	}

	/**
	 * @inheritDoc
	 */
	get isCollapsed() {
		const length = this._ranges.length;

		return length === 0 ? true : super.isCollapsed;
	}

	/**
	 * @inheritDoc
	 */
	get anchor() {
		return super.anchor || this._getDefaultRange().start;
	}

	/**
	 * @inheritDoc
	 */
	get focus() {
		return super.focus || this._getDefaultRange().start;
	}

	/**
	 * @inheritDoc
	 */
	get rangeCount() {
		return this._ranges.length ? this._ranges.length : 1;
	}

	/**
	 * Unbinds all events previously bound by document selection.
	 */
	destroy() {
		for ( let i = 0; i < this._ranges.length; i++ ) {
			this._ranges[ i ].detach();
		}
	}

	/**
	 * @inheritDoc
	 */
	*getRanges() {
		if ( this._ranges.length ) {
			yield *super.getRanges();
		} else {
			yield this._getDefaultRange();
		}
	}

	/**
	 * @inheritDoc
	 */
	getFirstRange() {
		return super.getFirstRange() || this._getDefaultRange();
	}

	/**
	 * @inheritDoc
	 */
	getLastRange() {
		return super.getLastRange() || this._getDefaultRange();
	}

	/**
	 * @inheritDoc
	 */
	removeAllRanges() {
		this.destroy();
		super.removeAllRanges();
	}

	/**
	 * @inheritDoc
	 */
	setRanges( newRanges, isLastBackward ) {
		this.destroy();
		super.setRanges( newRanges, isLastBackward );
	}

	/**
	 * @inheritDoc
	 */
	clearAttributes() {
		this._setStoredAttributesTo( new Map() );
		super.clearAttributes();
	}

	/**
	 * @inheritDoc
	 */
	removeAttribute( key ) {
		this._removeStoredAttribute( key );
		super.removeAttribute( key );
	}

	/**
	 * @inheritDoc
	 */
	setAttribute( key, value ) {
		this._storeAttribute( key, value );
		super.setAttribute( key, value );
	}

	/**
	 * @inheritDoc
	 */
	setAttributesTo( attrs ) {
		this._setStoredAttributesTo( toMap( attrs ) );
		super.setAttributesTo( attrs );
	}

	/**
	 * @inheritDoc
	 */
	_popRange() {
		this._ranges.pop().detach();
	}

	/**
	 * @inheritDoc
	 */
	_pushRange( range ) {
		this._checkRange( range );
		this._ranges.push( LiveRange.createFromRange( range ) );
	}

	/**
	 * Returns a default range for this selection. The default range is a collapsed range that starts and ends
	 * at the beginning of this selection's document's {@link engine.model.Document#_getDefaultRoot default root}.
	 * This "artificial" range is important for algorithms that base on selection, so they won't break or need
	 * special logic if there are no real ranges in the selection.
	 *
	 * @private
	 * @returns {engine.model.Range}
	 */
	_getDefaultRange() {
		const defaultRoot = this._document._getDefaultRoot();

		// Find the first position where the selection can be put.
		for ( let position of Range.createIn( defaultRoot ).getPositions() ) {
			if ( this._document.schema.check( { name: '$text', inside: position } ) ) {
				return new Range( position, position );
			}
		}

		const position = new Position( defaultRoot, [ 0 ] );

		return new Range( position, position );
	}

	/**
	 * Iterates through all attributes stored in current selection's parent.
	 *
	 * @returns {Iterable.<*>}
	 */
	*_getStoredAttributes() {
		const selectionParent = this.getFirstPosition().parent;

		if ( this.isCollapsed && selectionParent.childCount === 0 ) {
			for ( let key of selectionParent.getAttributeKeys() ) {
				if ( key.indexOf( storePrefix ) === 0 ) {
					const realKey = key.substr( storePrefix.length );

					yield [ realKey, selectionParent.getAttribute( key ) ];
				}
			}
		}
	}

	/**
	 * Removes attribute with given key from attributes stored in current selection's parent node.
	 *
	 * @private
	 * @param {String} key Key of attribute to remove.
	 */
	_removeStoredAttribute( key ) {
		const selectionParent = this.getFirstPosition().parent;

		if ( this.isCollapsed && selectionParent.childCount === 0 ) {
			const storeKey = LiveSelection._getStoreAttributeKey( key );

			this._document.enqueueChanges( () => {
				this._document.batch().removeAttribute( selectionParent, storeKey );
			} );
		}
	}

	/**
	 * Stores given attribute key and value in current selection's parent node if the selection is collapsed and
	 * the parent node is empty.
	 *
	 * @private
	 * @param {String} key Key of attribute to set.
	 * @param {*} value Attribute value.
	 */
	_storeAttribute( key, value ) {
		const selectionParent = this.getFirstPosition().parent;

		if ( this.isCollapsed && selectionParent.childCount === 0 ) {
			const storeKey = LiveSelection._getStoreAttributeKey( key );

			this._document.enqueueChanges( () => {
				this._document.batch().setAttribute( selectionParent, storeKey, value );
			} );
		}
	}

	/**
	 * Sets selection attributes stored in current selection's parent node to given set of attributes.
	 *
	 * @param {Iterable|Object} attrs Iterable object containing attributes to be set.
	 * @private
	 */
	_setStoredAttributesTo( attrs ) {
		const selectionParent = this.getFirstPosition().parent;

		if ( this.isCollapsed && selectionParent.childCount === 0 ) {
			this._document.enqueueChanges( () => {
				const batch = this._document.batch();

				for ( let attr of this._getStoredAttributes() ) {
					const storeKey = LiveSelection._getStoreAttributeKey( attr[ 0 ] );

					batch.removeAttribute( selectionParent, storeKey );
				}

				for ( let attr of attrs ) {
					const storeKey = LiveSelection._getStoreAttributeKey( attr[ 0 ] );

					batch.setAttribute( selectionParent, storeKey, attr[ 1 ] );
				}
			} );
		}
	}

	/**
	 * Updates this selection attributes according to it's ranges and the document.
	 *
	 * @fires engine.model.LiveSelection#change:attribute
	 * @protected
	 */
	_updateAttributes() {
		const position = this.getFirstPosition();

		let attrs = null;

		if ( !this.isCollapsed ) {
			// 1. If selection is a range...
			const range = this.getFirstRange();

			// ...look for a first character node in that range and take attributes from it.
			for ( let item of range ) {
				// This is not an optimal solution because of https://github.com/ckeditor/ckeditor5-engine/issues/454.
				// It can be done better by using `break;` instead of checking `attrs === null`.
				if ( item.type == 'text' && attrs === null ) {
					attrs = item.item.getAttributes();
				}
			}
		} else {
			// 2. If the selection is a caret or the range does not contain a character node...

			const nodeBefore = position.textNode ? position.textNode : position.nodeBefore;
			const nodeAfter = position.textNode ? position.textNode : position.nodeAfter;

			// ...look at the node before caret and take attributes from it if it is a character node.
			attrs = getAttrsIfCharacter( nodeBefore );

			// 3. If not, look at the node after caret...
			if ( !attrs ) {
				attrs = getAttrsIfCharacter( nodeAfter );
			}

			// 4. If not, try to find the first character on the left, that is in the same node.
			if ( !attrs ) {
				let node = nodeBefore;

				while ( node && !attrs ) {
					node = node.previousSibling;
					attrs = getAttrsIfCharacter( node );
				}
			}

			// 5. If not found, try to find the first character on the right, that is in the same node.
			if ( !attrs ) {
				let node = nodeAfter;

				while ( node && !attrs ) {
					node = node.nextSibling;
					attrs = getAttrsIfCharacter( node );
				}
			}

			// 6. If not found, selection should retrieve attributes from parent.
			if ( !attrs ) {
				attrs = this._getStoredAttributes();
			}
		}

		if ( attrs ) {
			this._attrs = new Map( attrs );
		} else {
			this.clearAttributes();
		}

		function getAttrsIfCharacter( node ) {
			if ( node instanceof TextProxy || node instanceof Text ) {
				return node.getAttributes();
			}

			return null;
		}

		this.fire( 'change:attribute' );
	}

	/**
	 * Generates and returns an attribute key for selection attributes store, basing on original attribute key.
	 *
	 * @param {String} key Attribute key to convert.
	 * @returns {String} Converted attribute key, applicable for selection store.
	 */
	static _getStoreAttributeKey( key ) {
		return storePrefix + key;
	}
}
